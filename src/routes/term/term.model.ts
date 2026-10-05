import { z } from 'zod';
import { Term } from '../../entities/term.model.ts';
import { TermStatus, TermType } from '../../shared/constants/publisher.constant.ts';
import { PaginationQuerySchema } from '../../shared/models/request.model.ts';

export const TermIdParam = z
  .object({
    termId: z.uuid(),
  })
  .strict();

export const GetCurrentTermInput = z
  .object({
    type: z.enum([TermType.PUBLISHER_TERMS, TermType.CUSTOMER_TERMS, TermType.PRIVACY_POLICY]),
  })
  .strict();

export const TermOutput = Term.pick({
  id: true,
  type: true,
  version: true,
  title: true,
  content: true,
  status: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
});

export const CurrentTermOutput = TermOutput.pick({
  id: true,
  type: true,
  version: true,
  title: true,
  content: true,
  publishedAt: true,
});

export const TermListItemOutput = TermOutput.pick({
  id: true,
  type: true,
  version: true,
  title: true,
  status: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
});

export const GetTermListInput = PaginationQuerySchema.extend({
  type: z
    .enum([TermType.PUBLISHER_TERMS, TermType.CUSTOMER_TERMS, TermType.PRIVACY_POLICY])
    .optional(),
  status: z.enum([TermStatus.DRAFT, TermStatus.ACTIVE, TermStatus.ARCHIVED]).optional(),
}).strict();

export const GetTermListOutput = z.object({
  items: z.array(TermListItemOutput),
  totalItems: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});

export const GetTermDetailOutput = TermOutput;

export const CreateTermInput = Term.pick({
  type: true,
  version: true,
  title: true,
  content: true,
}).strict();

export const CreateTermOutput = Term.pick({ id: true });

export const UpdateTermInput = Term.pick({
  title: true,
  content: true,
})
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export const UpdateTermStatusInput = z
  .object({
    status: z.enum([TermStatus.ACTIVE, TermStatus.ARCHIVED]),
  })
  .strict();

export type GetCurrentTermInputType = z.infer<typeof GetCurrentTermInput>;
export type GetTermListInputType = z.infer<typeof GetTermListInput>;
export type GetTermListOutputType = z.infer<typeof GetTermListOutput>;
export type GetTermDetailOutputType = z.infer<typeof GetTermDetailOutput>;
export type TermOutputType = z.infer<typeof TermOutput>;
export type CurrentTermOutputType = z.infer<typeof CurrentTermOutput>;
export type CreateTermInputType = z.infer<typeof CreateTermInput>;
export type UpdateTermInputType = z.infer<typeof UpdateTermInput>;
export type UpdateTermStatusInputType = z.infer<typeof UpdateTermStatusInput>;
