import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { HTTPMethod } from '../shared/constants/role.constant.ts';
import { API_PREFIX_PATH } from '../shared/constants/system.constant.ts';

export type AvailableRoute = {
  path: string;
  method: keyof typeof HTTPMethod;
  name: string;
  module: string;
  // The guard never answers 403 on these, so they sit outside the permission table
  // even though the seed still creates a row for them.
  isPublic: boolean;
  skipsPermissionCheck: boolean;
};

const excludedPermissionModules = new Set(['HEALTH', 'ROOT']);

const routeDecoratorMethodMap: Record<string, keyof typeof HTTPMethod> = {
  Get: HTTPMethod.GET,
  Post: HTTPMethod.POST,
  Put: HTTPMethod.PUT,
  Delete: HTTPMethod.DELETE,
  Patch: HTTPMethod.PATCH,
  Options: HTTPMethod.OPTIONS,
  Head: HTTPMethod.HEAD,
};
const currentFilePath = fileURLToPath(import.meta.url);
const sourceRoot = path.resolve(path.dirname(currentFilePath), '..');

function normalizePath(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (normalizedPath === API_PREFIX_PATH || normalizedPath.startsWith(`${API_PREFIX_PATH}/`)) {
    return normalizedPath;
  }
  return `${API_PREFIX_PATH}${normalizedPath}`;
}

function getModuleName(path: string) {
  const pathWithoutPrefix = path === API_PREFIX_PATH ? '/' : path.slice(API_PREFIX_PATH.length);
  const [moduleName] = pathWithoutPrefix.split('/').filter(Boolean);
  return (moduleName ?? 'ROOT').toUpperCase();
}

export function buildPermissionKey(permission: { method: string; path: string }) {
  return `${permission.method}_${permission.path}`;
}

function getDecoratorCall(decorator: ts.Decorator) {
  const expression = decorator.expression;
  return ts.isCallExpression(expression) ? expression : null;
}

function getDecoratorName(decorator: ts.Decorator) {
  const callExpression = getDecoratorCall(decorator);
  const expression = callExpression?.expression;
  return expression && ts.isIdentifier(expression) ? expression.text : null;
}

function getDecoratorPath(decorator: ts.Decorator) {
  const callExpression = getDecoratorCall(decorator);
  const [firstArgument] = callExpression?.arguments ?? [];
  if (
    firstArgument &&
    (ts.isStringLiteral(firstArgument) || ts.isNoSubstitutionTemplateLiteral(firstArgument))
  ) {
    return firstArgument.text;
  }
  return '';
}

function isPublicDecorator(decorator: ts.Decorator) {
  const name = getDecoratorName(decorator);
  if (name === 'IsPublic') {
    return true;
  }
  if (name !== 'Auth') {
    return false;
  }
  const [firstArgument] = getDecoratorCall(decorator)?.arguments ?? [];
  return !!firstArgument && firstArgument.getText().includes('AuthType.None');
}

function joinRoutePath(controllerPath: string, methodPath: string) {
  return [controllerPath, methodPath]
    .map((item) => item.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

function getControllerFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return getControllerFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith('controller.ts') ? [entryPath] : [];
  });
}

function getRoutesFromControllerFile(filePath: string) {
  const sourceFile = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const routes: AvailableRoute[] = [];

  sourceFile.forEachChild((node) => {
    if (!ts.isClassDeclaration(node)) {
      return;
    }

    const classDecorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
    const controllerDecorator = classDecorators?.find((decorator) => {
      return getDecoratorName(decorator) === 'Controller';
    });
    if (!controllerDecorator) {
      return;
    }

    const controllerPath = getDecoratorPath(controllerDecorator);
    for (const member of node.members) {
      if (!ts.isMethodDeclaration(member)) {
        continue;
      }

      const methodDecorators = ts.canHaveDecorators(member) ? ts.getDecorators(member) : undefined;
      const routeDecorator = methodDecorators?.find((decorator) => {
        const decoratorName = getDecoratorName(decorator);
        return decoratorName ? routeDecoratorMethodMap[decoratorName] : false;
      });
      if (!routeDecorator) {
        continue;
      }

      const decoratorName = getDecoratorName(routeDecorator);
      if (!decoratorName) {
        continue;
      }

      const method = routeDecoratorMethodMap[decoratorName];
      const path = normalizePath(joinRoutePath(controllerPath, getDecoratorPath(routeDecorator)));
      const decorators = [...(classDecorators ?? []), ...(methodDecorators ?? [])];
      routes.push({
        path,
        method,
        name: `${method} ${path}`,
        module: getModuleName(path),
        isPublic: decorators.some(isPublicDecorator),
        skipsPermissionCheck: decorators.some(
          (decorator) => getDecoratorName(decorator) === 'SkipPermissionCheck',
        ),
      });
    }
  });

  return routes;
}

export function getRoutes() {
  const routeMap = new Map<string, AvailableRoute>();
  for (const controllerFile of getControllerFiles(sourceRoot)) {
    for (const route of getRoutesFromControllerFile(controllerFile)) {
      if (excludedPermissionModules.has(route.module)) {
        continue;
      }

      routeMap.set(buildPermissionKey(route), route);
    }
  }
  return [...routeMap.values()];
}
