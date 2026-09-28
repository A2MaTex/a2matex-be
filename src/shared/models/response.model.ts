import { z } from 'zod';
import { SUCCESS_RESPONSE_MESSAGE } from '../constants/system.constant.ts';

export const MessageResSchema = z.object({
  message: z.string(),
});

export type MessageResType = z.infer<typeof MessageResSchema>;

export const SUCCESS_RESPONSE: MessageResType = {
  message: SUCCESS_RESPONSE_MESSAGE,
};
