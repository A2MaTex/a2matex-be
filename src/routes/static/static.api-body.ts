export const startMultipartUploadBody = {
  schema: {
    type: 'object',
    required: [
      'originalFileName',
      'lastModified',
      'contentType',
      'size',
      'prefix',
      'requestedPartNumbers',
    ],
    properties: {
      originalFileName: {
        type: 'string',
        example: 'file.txt',
      },
      lastModified: {
        type: 'integer',
        example: Date.now(),
      },
      contentType: {
        type: 'string',
        example: 'text/plain',
      },
      size: {
        type: 'integer',
        example: 12345,
      },
      prefix: {
        type: 'string',
        example: 'launcher/releases',
      },
      requestedPartNumbers: {
        type: 'array',
        items: {
          type: 'integer',
        },
        example: [1, 2, 3],
      },
    },
  },
};

export const getCompletedPartsBody = {
  schema: {
    type: 'object',
    required: ['originalFileName', 'lastModified', 'contentType', 'size'],
    properties: {
      originalFileName: {
        type: 'string',
        example: 'file.txt',
      },
      lastModified: {
        type: 'integer',
        example: Date.now(),
      },
      contentType: {
        type: 'string',
        example: 'text/plain',
      },
      size: {
        type: 'integer',
        example: 12345,
      },
    },
  },
};

export const getBatchUrlsBody = {
  schema: {
    type: 'object',
    required: ['sessionId', 'partNumbers'],
    properties: {
      sessionId: {
        type: 'string',
        format: 'uuid',
      },
      partNumbers: {
        type: 'array',
        items: {
          type: 'integer',
          example: 1,
        },
      },
    },
  },
};

export const completeMultipartUploadBody = {
  schema: {
    type: 'object',
    required: ['sessionId', 'parts'],
    properties: {
      sessionId: {
        type: 'string',
        format: 'uuid',
      },
      parts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            partNumber: {
              type: 'integer',
              example: 1,
            },
            eTag: {
              type: 'string',
              example: 'etag',
            },
          },
        },
      },
    },
  },
};
