import { Test } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { AiProviderResolver } from './ai-provider-resolver.service'
import { PrismaService } from '../prisma/prisma.service'

describe('AiProviderResolver', () => {
  const build = async (opts: {
    aiProvider?: 'OPENAI' | 'ANTHROPIC' | null
    envProvider?: string
    findUnique?: jest.Mock
  }) => {
    const findUnique =
      opts.findUnique ?? jest.fn().mockResolvedValue({ aiProvider: opts.aiProvider ?? null })

    const module = await Test.createTestingModule({
      providers: [
        AiProviderResolver,
        { provide: PrismaService, useValue: { user: { findUnique } } },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(opts.envProvider) },
        },
      ],
    }).compile()

    return { resolver: module.get(AiProviderResolver), findUnique }
  }

  it('defaults to OPENAI when nothing is configured', async () => {
    const { resolver } = await build({})
    expect(await resolver.resolve('u1')).toBe('OPENAI')
  })

  it('falls back to the AI_PROVIDER env default when the user has no choice', async () => {
    const { resolver } = await build({ aiProvider: null, envProvider: 'anthropic' })
    expect(await resolver.resolve('u1')).toBe('ANTHROPIC')
  })

  it('accepts AI_PROVIDER case-insensitively and ignores junk', async () => {
    expect((await build({ envProvider: 'AnThRoPiC' })).resolver.systemDefault()).toBe('ANTHROPIC')
    expect((await build({ envProvider: 'nonsense' })).resolver.systemDefault()).toBe('OPENAI')
  })

  it("prefers the user's saved choice over the env default", async () => {
    const { resolver } = await build({ aiProvider: 'OPENAI', envProvider: 'anthropic' })
    expect(await resolver.resolve('u1')).toBe('OPENAI')
  })

  it('uses the system default when no userId is given', async () => {
    const { resolver, findUnique } = await build({ envProvider: 'anthropic' })
    expect(await resolver.resolve(undefined)).toBe('ANTHROPIC')
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('caches the lookup and re-reads after invalidate()', async () => {
    const { resolver, findUnique } = await build({ aiProvider: 'ANTHROPIC' })

    await resolver.resolve('u1')
    await resolver.resolve('u1')
    expect(findUnique).toHaveBeenCalledTimes(1)

    resolver.invalidate('u1')
    await resolver.resolve('u1')
    expect(findUnique).toHaveBeenCalledTimes(2)
  })

  it('caches per user', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({ aiProvider: 'ANTHROPIC' })
      .mockResolvedValueOnce({ aiProvider: 'OPENAI' })
    const { resolver } = await build({ findUnique })

    expect(await resolver.resolve('u1')).toBe('ANTHROPIC')
    expect(await resolver.resolve('u2')).toBe('OPENAI')
  })

  // A settings lookup must never take down an LLM call.
  it('falls back to the system default when the DB read fails', async () => {
    const findUnique = jest.fn().mockRejectedValue(new Error('connection refused'))
    const { resolver } = await build({ findUnique, envProvider: 'anthropic' })

    expect(await resolver.resolve('u1')).toBe('ANTHROPIC')
  })
})
