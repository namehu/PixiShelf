import { z } from 'zod'
import { canonicalMediaContentPath } from '../media-content/roots.ts'
import type { MaintenanceFileState } from './maintenance-files.ts'

const decimal = z
  .string()
  .regex(/^-?\d+$/)
  .max(40)
const canonical = z
  .string()
  .min(1)
  .max(8192)
  .refine((value) => {
    try {
      canonicalMediaContentPath(value)
      return true
    } catch {
      return false
    }
  })
const fileState = z
  .object({ size: decimal, mtimeNs: decimal, ctimeNs: decimal, deviceId: decimal, inode: decimal, linkCount: decimal })
  .strict()
export const maintenanceDirectoryCheckpointSchema = z
  .object({
    version: z.literal(1),
    visited: z.number().int().min(0).max(10000),
    stack: z
      .array(
        z
          .object({
            relativePath: canonical,
            afterName: z
              .string()
              .min(1)
              .max(255)
              .refine((value) => !/[\/\\\0]/.test(value) && value !== '.' && value !== '..')
              .nullable(),
            expectedState: fileState.nullable()
          })
          .strict()
          .refine((value) => value.afterName === null || value.expectedState !== null)
      )
      .max(12)
  })
  .strict()
export type MaintenanceDirectoryCheckpoint = z.infer<typeof maintenanceDirectoryCheckpointSchema>
export function readMaintenanceDirectoryCheckpoint(
  value: unknown,
  exclusiveDirectory: string
): MaintenanceDirectoryCheckpoint {
  canonicalMediaContentPath(exclusiveDirectory)
  const checkpoint =
    value === null
      ? {
          version: 1 as const,
          visited: 0,
          stack: [{ relativePath: exclusiveDirectory, afterName: null, expectedState: null }]
        }
      : maintenanceDirectoryCheckpointSchema.parse(value)
  for (const [index, frame] of checkpoint.stack.entries()) {
    const parent = index === 0 ? exclusiveDirectory : checkpoint.stack[index - 1]!.relativePath
    if (
      (index === 0 && frame.relativePath !== parent) ||
      (index > 0 &&
        (!frame.relativePath.startsWith(`${parent}/`) || frame.relativePath.slice(parent.length + 1).includes('/')))
    )
      throw new Error('Invalid directory checkpoint scope')
  }
  return checkpoint
}
export function encodeMaintenanceDirectoryState(state: MaintenanceFileState) {
  return {
    size: state.size.toString(),
    mtimeNs: state.mtimeNs.toString(),
    ctimeNs: state.ctimeNs.toString(),
    deviceId: state.deviceId.toString(),
    inode: state.inode.toString(),
    linkCount: state.linkCount.toString()
  }
}
export function decodeMaintenanceDirectoryState(state: z.infer<typeof fileState> | null): MaintenanceFileState | null {
  return state === null
    ? null
    : {
        size: BigInt(state.size),
        mtimeNs: BigInt(state.mtimeNs),
        ctimeNs: BigInt(state.ctimeNs),
        deviceId: BigInt(state.deviceId),
        inode: BigInt(state.inode),
        linkCount: BigInt(state.linkCount)
      }
}
