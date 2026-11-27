-- Hai giá trị enum mới, và KHÔNG GÌ KHÁC.
--
-- Prisma bọc mỗi file migration trong một transaction, mà PostgreSQL không cho dùng một giá
-- trị enum vừa thêm trong chính transaction đã thêm nó. Ràng buộc accountKind_check ở
-- migration kế tiếp có nhắc tên hai giá trị này, nên gộp hai file làm một sẽ gãy với
-- "unsafe use of new value of enum type".
ALTER TYPE "WalletTransactionType" ADD VALUE 'WITHDRAWAL';
ALTER TYPE "WalletTransactionType" ADD VALUE 'WITHDRAWAL_REVERSAL';
