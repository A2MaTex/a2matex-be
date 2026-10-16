import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { WorkflowValidationController } from '../workflow-validation.controller.ts';
import { WorkflowValidationService } from '../workflow-validation.service.ts';

vi.mock('../workflow-validation.service.ts', () => ({
  WorkflowValidationService: class WorkflowValidationService {},
}));

const VALID_BODY = {
  editorGraph: {
    schemaVersion: 1,
    entryNodeId: 'start_01',
    nodes: [
      {
        id: 'start_01',
        type: 'flow.start',
        config: {},
        bindings: {},
        errorPolicy: 'STOP',
        editor: { x: 0, y: 0 },
      },
      {
        id: 'end_01',
        type: 'flow.end',
        config: {},
        bindings: {},
        errorPolicy: 'STOP',
        editor: { x: 1, y: 0 },
      },
    ],
    edges: [
      {
        id: 'edge_01',
        sourceNodeId: 'start_01',
        sourcePort: 'success',
        targetNodeId: 'end_01',
      },
    ],
  },
};

describe('WorkflowValidationController routes', () => {
  let app: INestApplication;
  const validate = vi.fn();

  beforeEach(async () => {
    validate.mockResolvedValue({ status: 'VALID', errors: [], warnings: [], truncated: false });
    const moduleRef = await Test.createTestingModule({
      controllers: [WorkflowValidationController],
      providers: [{ provide: WorkflowValidationService, useValue: { validate } }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    validate.mockReset();
  });

  it('rejects a malformed request envelope before service execution', async () => {
    await request(app.getHttpServer())
      .post('/workflow-validation')
      .send({ editorGraph: [] })
      .expect(422);
    expect(validate).not.toHaveBeenCalled();
  });

  it('passes malformed graph content to the validation engine', async () => {
    await request(app.getHttpServer())
      .post('/workflow-validation')
      .send({ editorGraph: { ...VALID_BODY.editorGraph, unknown: true } })
      .expect(200);
    expect(validate).toHaveBeenCalledWith({ ...VALID_BODY.editorGraph, unknown: true });
  });

  it('delegates a valid graph to the service', async () => {
    await request(app.getHttpServer()).post('/workflow-validation').send(VALID_BODY).expect(200);

    expect(validate).toHaveBeenCalledWith(VALID_BODY.editorGraph);
  });
});
