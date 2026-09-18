import { ConnectorType } from '@prisma/client'
import { HotSpotService } from './hotspot.service'

describe('HotSpotService', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it('counts unique vacation slots belonging to the configured employee', async () => {
    const credentials = {
      getTokens: jest.fn().mockResolvedValue({ accessToken: 'secret-key' }),
      getMetadata: jest.fn().mockResolvedValue({ externalAccountId: 'ETNC693HPP' }),
      markInvalid: jest.fn(),
    }
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { employeeId: 'ETNC693HPP', date: '2026-08-03', half: 'am', allocationType: 'vacation' },
          { employeeId: 'ETNC693HPP', date: '2026-08-03', half: 'am', allocationType: 'vacation' },
          { employeeId: 'ETNC693HPP', date: '2026-08-03', half: 'am', allocationType: 'vacation' },
          { employeeId: 'ETNC693HPP', date: '2026-08-03', half: 'pm', allocationType: 'VACATION' },
          { employeeId: 'ETNC693HPP', date: '2026-08-03', half: 'am', allocationType: 'project' },
          { employeeId: 'OTHER', date: '2026-08-03', half: 'pm', allocationType: 'vacation' },
          { employeeId: 'ETNC693HPP', date: '2026-09-01', half: 'am', allocationType: 'vacation' },
        ],
      }),
    } as Response)

    const service = new HotSpotService(credentials as never)
    const seconds = await service.getVacationSeconds('user-1', 2026, 8, 8)

    expect(seconds).toBe(8 * 3600)
    expect(credentials.getTokens).toHaveBeenCalledWith('user-1', ConnectorType.HOTSPOT)
    expect(global.fetch).toHaveBeenCalledWith(
      expect.objectContaining({ search: expect.stringContaining('employeeId=ETNC693HPP') }),
      { headers: { Authorization: 'Bearer secret-key' } },
    )
  })

  it('excludes future vacation slots when querying the current month', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-19T12:00:00Z'))
    const credentials = {
      getTokens: jest.fn().mockResolvedValue({ accessToken: 'secret-key' }),
      getMetadata: jest.fn().mockResolvedValue({ externalAccountId: 'ETNC693HPP' }),
    }
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { employeeId: 'ETNC693HPP', date: '2026-08-19', half: 'am', allocationType: 'vacation' },
          { employeeId: 'ETNC693HPP', date: '2026-08-20', half: 'pm', allocationType: 'vacation' },
        ],
      }),
    } as Response)

    const service = new HotSpotService(credentials as never)
    const seconds = await service.getVacationSeconds('user-1', 2026, 8, 8)

    expect(seconds).toBe(4 * 3600)
    expect(global.fetch).toHaveBeenCalledWith(
      expect.objectContaining({ search: expect.stringContaining('to=2026-08-19') }),
      expect.anything(),
    )
  })

  it('reports the internal network as unavailable when HOT SPOT cannot be reached', async () => {
    const credentials = {
      getTokens: jest.fn().mockResolvedValue({ accessToken: 'secret-key' }),
      getMetadata: jest.fn().mockResolvedValue({ externalAccountId: 'ETNC693HPP' }),
    }
    global.fetch = jest.fn().mockRejectedValue(new Error('network unavailable'))

    const service = new HotSpotService(credentials as never)

    await expect(service.isInternalNetworkAvailable('user-1')).resolves.toBe(false)
  })

  it('validates before storing a new credential', async () => {
    const credentials = { storeCredential: jest.fn() }
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    } as Response)

    const service = new HotSpotService(credentials as never)
    await service.connectWithApiKey('user-1', 'secret-key', 'ETNC693HPP')

    expect(credentials.storeCredential).toHaveBeenCalledWith(expect.objectContaining({
      connectorType: ConnectorType.HOTSPOT,
      externalAccountId: 'ETNC693HPP',
      accessToken: 'secret-key',
    }))
  })
})