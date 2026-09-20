import { randomInt } from 'crypto';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export const generateOTP = () => {
  return String(randomInt(100000, 1000000));
};

export const generateRandomFilename = (filename: string) => {
  const ext = path.extname(filename);
  return `${uuidv4()}${ext}`;
};

export const generateCancelPaymentJobId = (paymentId: number) => {
  return `paymentId-${paymentId}`;
};

export const generateRoomUserId = (userId: number) => {
  return `userId-${userId}`;
};
