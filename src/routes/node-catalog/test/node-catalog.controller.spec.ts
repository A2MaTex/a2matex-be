import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { NodeCatalogController } from '../node-catalog.controller.ts';
import { NodeCatalogService } from '../node-catalog.service.ts';

vi.mock('../node-catalog.service.ts', () => ({
  NodeCatalogService: class NodeCatalogService {},
}));

const catalog = {
  catalogHash: 'a'.repeat(64),
  nodes: [],
};

describe('NodeCatalogController', () => {
  let app: INestApplication;
  const getCatalog = vi.fn();

  beforeEach(async () => {
    getCatalog.mockResolvedValue(catalog);
    const moduleRef = await Test.createTestingModule({
      controllers: [NodeCatalogController],
      providers: [{ provide: NodeCatalogService, useValue: { getCatalog } }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    getCatalog.mockReset();
  });

  it.each(['/node-catalog', '/node-catalog?runtimeVersion=v0.1'])(
    'rejects invalid query %s before calling the service',
    async (path) => {
      await request(app.getHttpServer()).get(path).expect(422);
      expect(getCatalog).not.toHaveBeenCalled();
    },
  );

  it('accepts a valid Runtime version', async () => {
    await request(app.getHttpServer()).get('/node-catalog?runtimeVersion=0.1.0').expect(200);

    expect(getCatalog).toHaveBeenCalledWith({ runtimeVersion: '0.1.0' });
  });

  it('returns 304 for a matching ETag', async () => {
    await request(app.getHttpServer())
      .get('/node-catalog?runtimeVersion=0.1.0')
      .set('If-None-Match', `"${catalog.catalogHash}"`)
      .expect(304);
  });
});
