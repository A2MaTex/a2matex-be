// Khai đủ năm giá trị ngay từ đầu dù lát cắt này chỉ sinh PENDING và CANCELLED: thêm giá
// trị enum về sau lại phải tách migration riêng.
export const WithdrawalRequestStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
} as const;

export type WithdrawalRequestStatusValue =
  (typeof WithdrawalRequestStatus)[keyof typeof WithdrawalRequestStatus];

export const WITHDRAWAL_PAGE_SIZE_MAX = 100;

// 24 giờ thật kể từ lúc tạo đơn gần nhất, không phải sang ngày lịch; đơn đã huỷ vẫn tính.
// Hằng số chứ không nằm ở SystemSetting là CỐ Ý: mức tối thiểu là chính sách thương mại
// admin phải đổi được, còn mốc này là luật chống lạm dụng.
export const WITHDRAWAL_COOLDOWN_HOURS = 24;
