# API Contract: 008-studio-release

Prefix: `/api/v1`. Mọi phản hồi thành công được bọc `{ "data": ..., "statusCode": ... }`; lỗi trả
`{ "statusCode": ..., "message": ... }`, riêng 422 có `message` là mảng `{ message, path }`.

Trừ `GET /studio-releases/current`, mọi route đều cần `Authorization: Bearer <token>` và permission
của role Admin (seed gán tự động — [research.md](./research.md) R12).

| Method | Path | Auth | FR |
| --- | --- | --- | --- |
| GET | `/studio-releases/current` | công khai | FR-012, FR-013 |
| GET | `/studio-releases` | Admin | FR-014, FR-022, FR-023 |
| GET | `/studio-releases/:studioReleaseId` | Admin | FR-015, FR-023 |
| POST | `/studio-releases` | Admin | FR-001…FR-005 |
| PUT | `/studio-releases/:studioReleaseId` | Admin | FR-016 |
| PUT | `/studio-releases/:studioReleaseId/activate` | Admin | FR-006…FR-011 |
| PUT | `/studio-releases/:studioReleaseId/deactivate` | Admin | FR-021 |

`:studioReleaseId` phải là UUID; sai định dạng trả 422.

## Mã lỗi

| Mã | HTTP | Khi nào |
| --- | --- | --- |
| `Error.StudioReleaseNotFound` | 404 | không có bản phát hành với id đó (hoặc đã xoá mềm) |
| `Error.ActiveStudioReleaseNotFound` | 404 | không có bản hiệu lực, hoặc bản hiệu lực có tệp đã xoá |
| `Error.StudioReleaseAlreadyActive` | 409 | kích hoạt bản đang hiệu lực |
| `Error.StudioReleaseNotActive` | 409 | gỡ hiệu lực bản không ở trạng thái hiệu lực |
| `Error.StudioReleaseVersionTaken` | 409 | trùng số phiên bản (từ `P2002`, R1) |
| `Error.StudioReleaseActiveNotEditable` | 409 | đổi `version`/`staticId` của bản đang hiệu lực |
| `Error.StudioReleaseVersionInvalid` | 422 | sai định dạng semver, path `version` — message của Zod, không phải exception class |
| `Error.StaticNotFound` | 422 | `staticId` không tồn tại hoặc đã xoá, path `staticId` |

Khoá phân tán của `update`/`activate`/`deactivate` khi bị chiếm trả 409 với thông điệp chung của
`@DistributedLock` (`DISTRIBUTED_LOCK_CONFLICT_MESSAGE`), không phải mã ở bảng trên. `update` dùng
chung khoá với `activate` để một activate xen giữa không làm đổi được `version`/`staticId` của bản
vừa thành hiệu lực (FR-016).

## GET /studio-releases/current

Không tham số. `200`:

```json
{
  "data": {
    "id": "7abb2b89-08ba-42a1-9c29-cd62d3e64c26",
    "version": "1.4.0",
    "staticId": "5c1f0a76-2b94-4f3e-8d61-0a2c7e9b4d15",
    "releaseNotes": "Sửa lỗi lưu workflow khi mất mạng",
    "publishedAt": "2026-11-23T04:42:21.804Z"
  },
  "statusCode": 200
}
```

`404 Error.ActiveStudioReleaseNotFound` khi chưa có bản nào hiệu lực, hoặc bản hiệu lực trỏ tới tệp
đã bị xoá. Studio tự so `version` với phiên bản đang chạy; tải tệp bằng `staticId` qua
`GET /statics/files/:staticId` — **route đó cần đăng nhập** (FR-020).

## GET /studio-releases

Query: `page` (mặc định 1), `pageSize` (mặc định 10, **tối đa 100** — vượt trả 422). Tham số lạ bị
từ chối 422. `200`:

```json
{
  "data": {
    "items": [
      {
        "id": "7abb2b89-08ba-42a1-9c29-cd62d3e64c26",
        "version": "1.4.0",
        "staticId": "5c1f0a76-2b94-4f3e-8d61-0a2c7e9b4d15",
        "isActive": true,
        "publishedAt": "2026-11-23T04:42:21.804Z",
        "createdAt": "2026-11-23T04:40:00.000Z",
        "originalFileName": "a2matex-studio-1.4.0-setup.exe",
        "size": 148234752
      }
    ],
    "totalItems": 3,
    "page": 1,
    "pageSize": 10,
    "totalPages": 1
  },
  "statusCode": 200
}
```

Sắp xếp `createdAt DESC, id DESC` — **không** theo số phiên bản, vì rollback khiến bản mới nhất
không phải bản cao nhất. Bản có tệp đã xoá vẫn nằm trong danh sách (FR-023).

## GET /studio-releases/:studioReleaseId

`200`: như một item của danh sách, bỏ `originalFileName`/`size` ở mức gốc, thêm `releaseNotes`,
`updatedAt` và đối tượng `static`:

```json
{
  "data": {
    "id": "7abb2b89-08ba-42a1-9c29-cd62d3e64c26",
    "version": "1.4.0",
    "staticId": "5c1f0a76-2b94-4f3e-8d61-0a2c7e9b4d15",
    "releaseNotes": "Sửa lỗi lưu workflow khi mất mạng",
    "isActive": true,
    "publishedAt": "2026-11-23T04:42:21.804Z",
    "createdAt": "2026-11-23T04:40:00.000Z",
    "updatedAt": null,
    "static": {
      "id": "5c1f0a76-2b94-4f3e-8d61-0a2c7e9b4d15",
      "originalFileName": "a2matex-studio-1.4.0-setup.exe",
      "contentType": "application/octet-stream",
      "size": 148234752
    }
  },
  "statusCode": 200
}
```

## POST /studio-releases

Body `.strict()`:

```json
{
  "version": "1.4.0",
  "staticId": "5c1f0a76-2b94-4f3e-8d61-0a2c7e9b4d15",
  "releaseNotes": "Sửa lỗi lưu workflow khi mất mạng"
}
```

`releaseNotes` tuỳ chọn, nếu có thì không rỗng sau khi trim. `201` trả `{ "id": "..." }`. Bản mới
luôn `isActive = false` (FR-002) — không nhận `isActive` từ client.

Lỗi: `422 Error.StudioReleaseVersionInvalid` (sai semver), `422 Error.StaticNotFound`,
`409 Error.StudioReleaseVersionTaken`.

## PUT /studio-releases/:studioReleaseId

Body `.strict()`, partial, **ít nhất một trường** trong `version` / `staticId` / `releaseNotes`;
rỗng trả 422. `200` trả `{ "message": "Success" }`.

Với bản **đang hiệu lực**, chỉ `releaseNotes` được chấp nhận; gửi kèm `version` hoặc `staticId` trả
`409 Error.StudioReleaseActiveNotEditable` và **không** ghi gì (FR-016).

Route này dùng chung khoá phân tán với `activate`/`deactivate`, nên khi một thao tác kích hoạt đang
chạy thì ngay cả yêu cầu chỉ sửa ghi chú cũng có thể nhận `409` với thông điệp chung của khoá. Client
nên thử lại.

Lỗi khác: `404 Error.StudioReleaseNotFound`, `422 Error.StudioReleaseVersionInvalid`,
`422 Error.StaticNotFound`, `409 Error.StudioReleaseVersionTaken`.

## PUT /studio-releases/:studioReleaseId/activate

Không body. `200` trả `{ "message": "Success" }`. Trong một transaction: tắt mọi bản `isActive`
khác → bật bản này → set `publishedAt` nếu còn `NULL`.

Lỗi: `404 Error.StudioReleaseNotFound`, `409 Error.StudioReleaseAlreadyActive`,
`422 Error.StaticNotFound` (tệp đã xoá mềm, FR-010).

Cho phép kích hoạt bản có số phiên bản thấp hơn bản đang hiệu lực (FR-011) — không có kiểm tra nào
so sánh phiên bản.

## PUT /studio-releases/:studioReleaseId/deactivate

Không body. `200` trả `{ "message": "Success" }`. Sau đó không còn bản hiệu lực nào và
`GET /studio-releases/current` trả 404. `publishedAt` giữ nguyên (FR-008).

Lỗi: `404 Error.StudioReleaseNotFound`, `409 Error.StudioReleaseNotActive`.
