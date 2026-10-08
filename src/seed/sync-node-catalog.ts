import '../shared/config.ts';
import { NodeCatalogPublisherService } from '../routes/node-catalog/node-catalog-publisher.service.ts';
import { NodeCatalogRepo } from '../routes/node-catalog/node-catalog.repo.ts';
import { PrismaService } from '../shared/services/prisma.service.ts';

const prisma = new PrismaService();
const repository = new NodeCatalogRepo(prisma);
const publisher = new NodeCatalogPublisherService(repository);

publisher
  .publish()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
