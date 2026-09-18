import { ConnectorType } from '@prisma/client'
import { ClockifyService } from './clockify.service'

describe('ClockifyService.getWorklogIssuesForMonth', () => {
  it('creates billable time entries', async () => {
    const mockCredentials = {
      getTokens: jest.fn().mockResolvedValue({
        accessToken: 'api-key',
        workspaceId: 'ws-1',
        accountId: 'u-1',
      }),
    }
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 'entry-1', timeInterval: { start: '2026-08-19T12:00:00.000Z' } }),
    })
    const originalFetch = global.fetch
    global.fetch = fetchMock

    try {
      const service = new ClockifyService(mockCredentials as never)

      await service.addWorklog('user-1', '2026-08-19', 3600, 'Client meeting', 'PROJ-123', 'project-1')

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.clockify.me/api/v1/workspaces/ws-1/time-entries',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            start: '2026-08-19T12:00:00.000Z',
            end: '2026-08-19T13:00:00.000Z',
            description: 'PROJ-123 Client meeting',
            billable: true,
            projectId: 'project-1',
          }),
        }),
      )
    } finally {
      global.fetch = originalFetch
    }
  })

  it('aggregates entries by project (Issue/Projekt column) only', async () => {
    const mockCredentials = {
      getTokens: jest.fn().mockResolvedValue({
        accessToken: 'api-key',
        workspaceId: 'ws-1',
        accountId: 'u-1',
      }),
    }

    const service = new ClockifyService(mockCredentials as never)

    const entries = [
      {
        id: '1',
        projectId: '6a23235f177ca3150f6c9727',
        description: 'ALLIANZ | GEO - prvni cast',
        timeInterval: {
          start: '2026-06-05T10:00:00Z',
          end: '2026-06-05T12:00:00Z',
          duration: 'PT2H',
        },
      },
      {
        id: '2',
        projectId: '6a23235f177ca3150f6c9727',
        description: 'ALLIANZ | GEO - druha cast PROJ-321',
        timeInterval: {
          start: '2026-06-06T10:00:00Z',
          end: '2026-06-06T13:00:00Z',
          duration: 'PT3H',
        },
      },
      {
        id: '3',
        projectId: 'another-project',
        description: 'Other work',
        timeInterval: {
          start: '2026-06-07T10:00:00Z',
          end: '2026-06-07T11:00:00Z',
          duration: 'PT1H',
        },
      },
    ]

    const fetchSpy = jest
      .spyOn(service as never, 'fetchAllTimeEntries')
      .mockResolvedValue(entries as never)

    const result = await service.getWorklogIssuesForMonth('user-1', 2026, 6)

    expect(mockCredentials.getTokens).toHaveBeenCalledWith('user-1', ConnectorType.CLOCKIFY)
    expect(fetchSpy).toHaveBeenCalled()

    expect(result).toHaveLength(2)

    const aggregated = result.find((r) => r.project === '6a23235f177ca3150f6c9727')
    expect(aggregated).toBeDefined()
    expect(aggregated?.totalSeconds).toBe(18000)
    expect(aggregated?.jiraIssueKey).toBe('PROJ-321')

    const other = result.find((r) => r.project === 'another-project')
    expect(other?.totalSeconds).toBe(3600)
  })

  it('vrátí detailní entries pro konkrétní reference v měsíci', async () => {
    const mockCredentials = {
      getTokens: jest.fn().mockResolvedValue({
        accessToken: 'api-key',
        workspaceId: 'ws-1',
        accountId: 'u-1',
      }),
    }

    const service = new ClockifyService(mockCredentials as never)

    const entries = [
      {
        id: '1',
        projectId: 'Internal',
        description: 'Daily standup',
        timeInterval: {
          start: '2026-06-05T10:00:00Z',
          end: '2026-06-05T11:00:00Z',
          duration: 'PT1H',
        },
      },
      {
        id: '2',
        projectId: 'Internal',
        description: 'Planning',
        timeInterval: {
          start: '2026-06-06T10:00:00Z',
          end: '2026-06-06T10:30:00Z',
          duration: 'PT30M',
        },
      },
      {
        id: '3',
        projectId: 'Other',
        description: 'Other work',
        timeInterval: {
          start: '2026-06-07T10:00:00Z',
          end: '2026-06-07T11:00:00Z',
          duration: 'PT1H',
        },
      },
    ]

    const fetchSpy = jest
      .spyOn(service as never, 'fetchAllTimeEntries')
      .mockResolvedValue(entries as never)

    const result = await service.getWorklogEntriesForIssueInMonth('user-1', 2026, 6, 'Internal')

    expect(mockCredentials.getTokens).toHaveBeenCalledWith('user-1', ConnectorType.CLOCKIFY)
    expect(fetchSpy).toHaveBeenCalled()
    expect(result).toEqual([
      {
        id: '1',
        project: 'Internal',
        description: 'Daily standup',
        started: '2026-06-05T10:00:00Z',
        timeSpentSeconds: 3600,
      },
      {
        id: '2',
        project: 'Internal',
        description: 'Planning',
        started: '2026-06-06T10:00:00Z',
        timeSpentSeconds: 1800,
      },
    ])
  })
})
