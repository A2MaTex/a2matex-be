import { UnprocessableEntityException } from '@nestjs/common'
import { createZodValidationPipe, ZodValidationPipe } from 'nestjs-zod'
import { ZodError } from 'zod'

/**
 * Validates incoming DTOs with Zod and returns 422 responses with flattened field paths.
 */
const CustomZodValidationPipe: typeof ZodValidationPipe = createZodValidationPipe({
  createValidationException: (error: unknown) => {
    if (!(error instanceof ZodError)) {
      return new UnprocessableEntityException(error)
    }
    return new UnprocessableEntityException(
      error.issues.map((issue) => {
        return {
          ...issue,
          path: issue.path.join('.'),
        }
      }),
    )
  },
})

export default CustomZodValidationPipe
