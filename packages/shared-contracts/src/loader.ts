import { readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ProductContractSchema } from './schemas/product-contract.schema.js';
import { SourcePolicyContractSchema } from './schemas/source-policy.schema.js';
import { DataLifecycleContractSchema } from './schemas/data-lifecycle.schema.js';
import type { ZodSchema } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONTRACTS_DIR = resolve(__dirname, '../../..', 'contracts');

export function loadYamlFile(filePath: string): unknown {
  const content = readFileSync(filePath, 'utf-8');
  return parseYaml(content);
}

export function loadAndValidateContract<T>(filePath: string, schema: ZodSchema<T>): T {
  const raw = loadYamlFile(filePath);
  return schema.parse(raw);
}

export function getContractPath(contractName: string): string {
  return resolve(CONTRACTS_DIR, contractName);
}

export interface ContractValidationResult {
  contract: string;
  valid: boolean;
  errors?: string[];
}

export function validateAllContracts(): ContractValidationResult[] {
  const contracts: Array<{ name: string; file: string; schema: ZodSchema }> = [
    { name: 'product_contract', file: 'product_contract.yaml', schema: ProductContractSchema },
    { name: 'source_policy', file: 'source_policy.yaml', schema: SourcePolicyContractSchema },
    { name: 'data_lifecycle', file: 'data_lifecycle.yaml', schema: DataLifecycleContractSchema },
  ];

  return contracts.map(({ name, file, schema }) => {
    try {
      const filePath = getContractPath(file);
      loadAndValidateContract(filePath, schema);
      return { contract: name, valid: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { contract: name, valid: false, errors: [message] };
    }
  });
}
