import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProjectStatus } from '../../shared/constants/project.constant.ts';
import { Transactional } from '../../shared/decorators/transactional.decorator.ts';
import { TransactionService } from '../../shared/services/transaction.service.ts';
import { isUniqueConstraintPrismaError } from '../../shared/utils/prisma.ts';
import {
  ProjectAccessDeniedException,
  ProjectArchivedException,
  ProjectNotFoundException,
} from '../project/project.error.ts';
import { calculateProjectDraftSourceHash } from '../project-draft/project-draft.util.ts';
import {
  WorkflowRevisionAlreadyExistsException,
  workflowRevisionDraftVersionConflictException,
  WorkflowRevisionSourceIntegrityFailedException,
} from './workflow-revision.error.ts';
import type {
  CreateWorkflowRevisionInput,
  CreateWorkflowRevisionOutput,
} from './workflow-revision.model.ts';
import { WorkflowRevisionRepo } from './workflow-revision.repo.ts';
import {
  extractWorkflowNodeTypes,
  prepareWorkflowRevisionSourceSnapshot,
  requireAssetFreeWorkflow,
  requireJsonObject,
} from './workflow-revision.util.ts';

@Injectable()
export class WorkflowRevisionService {
  private readonly logger = new Logger(WorkflowRevisionService.name);

  constructor(
    @Inject(WorkflowRevisionRepo) private readonly workflowRevisionRepo: WorkflowRevisionRepo,
    @Inject(TransactionService) readonly transactionService: TransactionService,
  ) {}

  @Transactional()
  async createFromDraft({
    projectId,
    sourceDraftVersion,
    createdById,
    access,
  }: CreateWorkflowRevisionInput): Promise<CreateWorkflowRevisionOutput> {
    if (access.unrestricted) {
      throw ProjectAccessDeniedException;
    }

    const project = await this.workflowRevisionRepo.lockOwnedProject({
      projectId,
      publisherAccountId: access.publisherAccountId,
    });
    if (!project) {
      throw ProjectNotFoundException;
    }
    if (project.status === ProjectStatus.ARCHIVED) {
      throw ProjectArchivedException;
    }

    const draft = await this.workflowRevisionRepo.lockProjectDraft(projectId);
    if (!draft) {
      throw ProjectNotFoundException;
    }
    if (draft.version !== sourceDraftVersion) {
      throw workflowRevisionDraftVersionConflictException(draft.version);
    }
    // Draft `runtimeIr` is an authoring cache: never read, and a null or stale value must not
    // block a submission. The scan compiles the authoritative document from frozen source.
    const draftContent = {
      editorGraph: requireJsonObject(draft.editorGraph),
      inputSchema: requireJsonObject(draft.inputSchema),
    };
    const recomputedDraftHash = calculateProjectDraftSourceHash(draftContent);
    if (recomputedDraftHash !== draft.contentHash) {
      this.logger.error(
        'Workflow Revision source integrity failed ' +
          `projectId=${projectId} ` +
          `sourceDraftVersion=${sourceDraftVersion}\n` +
          `storedHash=${draft.contentHash}\n` +
          `recomputedHash=${recomputedDraftHash}`,
      );
      throw WorkflowRevisionSourceIntegrityFailedException;
    }

    requireAssetFreeWorkflow(draftContent.editorGraph);
    // A missing definition does not refuse the freeze: the scan reports it, so a Publisher
    // does not lose a submit to a catalog change it cannot see.
    const nodeTypes = extractWorkflowNodeTypes(draftContent.editorGraph);
    const definitions = await this.workflowRevisionRepo.getActiveNodeDefinitions(nodeTypes);

    const snapshot = prepareWorkflowRevisionSourceSnapshot({ draft, definitions });

    try {
      return await this.workflowRevisionRepo.create({
        projectId,
        sourceDraftVersion,
        sourceDraftContentHash: draft.contentHash,
        snapshot,
        createdById,
      });
    } catch (error) {
      if (isUniqueConstraintPrismaError(error)) {
        throw WorkflowRevisionAlreadyExistsException;
      }
      throw error;
    }
  }
}
