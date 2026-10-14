import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ProjectDraftController } from '../project-draft.controller.ts';
import { ProjectDraftService } from '../project-draft.service.ts';

vi.mock('../project-draft.service.ts', () => ({
  ProjectDraftService: class ProjectDraftService {},
}));

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

describe('ProjectDraftController routes', () => {
  let app: INestApplication;
  const get = vi.fn();
  const save = vi.fn();

  beforeEach(async () => {
    get.mockResolvedValue({ projectStatus: 'ACTIVE', draft: null });
    save.mockResolvedValue({
      id: '22222222-2222-4222-8222-222222222222',
      version: 1,
      contentHash: 'a'.repeat(64),
      savedAt: new Date(),
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [ProjectDraftController],
      providers: [{ provide: ProjectDraftService, useValue: { get, save } }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    get.mockReset();
    save.mockReset();
  });

  it('rejects an invalid Project ID before calling the service', async () => {
    await request(app.getHttpServer()).get('/projects/not-a-uuid/draft').expect(422);
    expect(get).not.toHaveBeenCalled();
  });

  it('rejects arrays in object-only draft fields', async () => {
    await request(app.getHttpServer())
      .put(`/projects/${PROJECT_ID}/draft`)
      .send({
        expectedVersion: 0,
        editorGraph: [],
        inputSchema: {},
        runtimeIr: null,
        validationSummary: {},
        testSummary: {},
      })
      .expect(422);
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects negative expected versions', async () => {
    await request(app.getHttpServer())
      .put(`/projects/${PROJECT_ID}/draft`)
      .send({
        expectedVersion: -1,
        editorGraph: {},
        inputSchema: {},
        runtimeIr: null,
        validationSummary: {},
        testSummary: {},
      })
      .expect(422);
    expect(save).not.toHaveBeenCalled();
  });

  it('accepts a valid strict draft body', async () => {
    const body = {
      expectedVersion: 0,
      editorGraph: {},
      inputSchema: {},
      runtimeIr: null,
      validationSummary: {},
      testSummary: {},
    };

    await request(app.getHttpServer()).put(`/projects/${PROJECT_ID}/draft`).send(body).expect(200);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID, data: body }),
    );
  });
});
