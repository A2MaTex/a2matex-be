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
