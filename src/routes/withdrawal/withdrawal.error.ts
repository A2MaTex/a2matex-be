import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

// Tư cách nhà phát hành dùng lại exception của PublisherModule, không định nghĩa lại ở đây.

export const WithdrawalIdempotencyKeyReusedException = new ConflictException(
  'Error.WithdrawalIdempotencyKeyReused',
);

// Ba ca dưới đều là câu trả lời nghiệp vụ: 422 chứ không để ràng buộc database bắt thành 500.
export const WithdrawalBelowMinimumException = new UnprocessableEntityException(
  'Error.WithdrawalBelowMinimum',
);

export const WithdrawalInsufficientBalanceException = new UnprocessableEntityException(
  'Error.WithdrawalInsufficientBalance',
);

// Kèm thời điểm sớm nhất được tạo đơn tiếp (FR-015).
export const withdrawalCooldownActiveException = (nextAllowedAt: Date) =>
  new UnprocessableEntityException({
    message: 'Error.WithdrawalCooldownActive',
    nextAllowedAt: nextAllowedAt.toISOString(),
  });

export const WithdrawalProfileNotFoundException = new NotFoundException(
  'Error.WithdrawalProfileNotFound',
);

// Đơn của người khác dùng ĐÚNG exception này: phân biệt là tiết lộ đơn đó có thật.
export const WithdrawalNotFoundException = new NotFoundException('Error.WithdrawalNotFound');

export const WithdrawalNotPendingException = new ConflictException('Error.WithdrawalNotPending');

// 503 CHỈ cho cấu hình thiếu/sai định dạng. Lỗi hạ tầng phải giữ nguyên hình dạng của nó,
// nếu không người vận hành bị chỉ đi sửa một dòng cấu hình hoàn toàn bình thường.
export const WithdrawalMinAmountUnavailableException = new ServiceUnavailableException(
  'Error.WithdrawalMinAmountUnavailable',
);

// ---- Quản trị viên (spec 013) ----

// Ba thao tác quản trị có ba điều kiện trạng thái khác nhau, nên mỗi cái một lỗi riêng:
// "sai trạng thái" trơ trụi không nói được người dùng phải làm gì tiếp.
export const WithdrawalNotApprovedException = new ConflictException(
  'Error.WithdrawalNotApproved',
);

export const WithdrawalCannotRejectException = new ConflictException(
  'Error.WithdrawalCannotReject',
);

export const WithdrawalRejectionReasonRequiredException = new UnprocessableEntityException(
  'Error.WithdrawalRejectionReasonRequired',
);

export const WithdrawalTransferRefRequiredException = new UnprocessableEntityException(
  'Error.WithdrawalTransferRefRequired',
);
