/**
 * MemoryBackend — EngineDatabase adapter for the agent-memory MemoryDatabase interface.
 *
 * Bridges EngineDatabase (SQLite persistence) to the agent-memory system's
 * MemoryDatabase interface, enabling persistent storage of long-term memories,
 * core rules, and user profiles with the existing 4-tier memory system.
 *
 * @module engine-db/adapters/memory-backend
 */

import type { EngineDatabase } from "../index"

// Re-export the interface shape (zero runtime deps — structural typing)
export interface MemoryDatabase {
  insertMemory(mem: {
    memory_id: string
    content: string
    token_count: number
    importance: number
    access_count: number
    created_at: number
    last_accessed: number
    retention_score: number
    category?: string
    tags?: string[]
  }): void
  getMemories(sessionId: string): Array<{
    memory_id: string
    content: string
    token_count: number
    importance: number
    access_count: number
    created_at: number
    last_accessed: number
    retention_score: number
    category?: string
    tags?: string[]
  }>
  searchByTags(tags: string[]): Array<{
    memory_id: string
    content: string
    token_count: number
    importance: number
    access_count: number
    created_at: number
    last_accessed: number
    retention_score: number
    category?: string
    tags?: string[]
  }>
  markSuccessful(memoryId: string): void
  getAgentSelfRules(): Array<{
    rule_id: string
    category: string
    content: string
    token_count: number
    importance: number
  }>
  upsertAgentSelfRule(rule: {
    rule_id: string
    category: string
    content: string
    token_count: number
    importance: number
  }): void
  getUserProfiles(userHash?: string): Array<{
    profile_id: string
    user_hash: string
    category: string
    content: string
    token_count: number
    importance: number
  }>
  upsertUserProfile(profile: {
    profile_id: string
    user_hash: string
    category: string
    content: string
    token_count: number
    importance: number
  }): void
}

/**
 * MemoryDatabase adapter backed by EngineDatabase.
 *
 * Usage:
 * ```ts
 * import { MemorySystem } from "@fengru/agent-memory"
 * import { EngineDatabase, MemoryBackend } from "@fengru/engine-db"
 *
 * const db = new EngineDatabase()
 * const backend = new MemoryBackend(db)
 * const memory = new MemorySystem()
 * memory.setDatabase(backend)
 * ```
 */
export class MemoryBackend implements MemoryDatabase {
  constructor(private engine: EngineDatabase) {}

  insertMemory(mem: Parameters<MemoryDatabase["insertMemory"]>[0]): void {
    this.engine.insertMemory({
      memory_id: mem.memory_id,
      content: mem.content,
      token_count: mem.token_count,
      importance: mem.importance,
      access_count: mem.access_count,
      created_at: mem.created_at,
      last_accessed: mem.last_accessed,
      retention_score: mem.retention_score,
      category: mem.category,
      tags: mem.tags,
    })
  }

  getMemories(sessionId: string): ReturnType<MemoryDatabase["getMemories"]> {
    return this.engine.getMemories(sessionId)
  }

  searchByTags(tags: string[]): ReturnType<MemoryDatabase["searchByTags"]> {
    return this.engine.searchByTags(tags)
  }

  markSuccessful(memoryId: string): void {
    this.engine.markSuccessful(memoryId)
  }

  getAgentSelfRules(): ReturnType<MemoryDatabase["getAgentSelfRules"]> {
    return this.engine.getAgentSelfRules()
  }

  upsertAgentSelfRule(rule: Parameters<MemoryDatabase["upsertAgentSelfRule"]>[0]): void {
    this.engine.upsertAgentSelfRule(rule)
  }

  getUserProfiles(userHash?: string): ReturnType<MemoryDatabase["getUserProfiles"]> {
    return this.engine.getUserProfiles(userHash)
  }

  upsertUserProfile(profile: Parameters<MemoryDatabase["upsertUserProfile"]>[0]): void {
    this.engine.upsertUserProfile(profile)
  }
}
