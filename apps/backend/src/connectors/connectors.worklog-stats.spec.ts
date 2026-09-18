import { ConnectorsController } from './connectors.controller'

describe('ConnectorsController Jira worklog stats cache', () => {
  function createController(
    jira: { getAllWorklogStats: jest.Mock },
    users: { getCachedJiraWorklogStats: jest.Mock; cacheJiraWorklogStats: jest.Mock },
  ): ConnectorsController {
    return new ConnectorsController(
      {} as never,
      {} as never,
      jira as never,
      users as never,
      { record: jest.fn() } as never, // TimeSavedService
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    )
  }

  it('returns a fresh cached total without scanning Jira', async () => {
    const jira = { getAllWorklogStats: jest.fn() }
    const users = {
      getCachedJiraWorklogStats: jest.fn().mockResolvedValue({
        count: 642,
        seconds: 1_234_567,
        updatedAt: new Date(),
      }),
      cacheJiraWorklogStats: jest.fn(),
    }
    const controller = createController(jira, users)

    const result = await controller.getJiraWorklogStats({ id: 'user-1' } as never)

    expect(result).toEqual({ success: true, data: { count: 642, seconds: 1_234_567 } })
    expect(jira.getAllWorklogStats).not.toHaveBeenCalled()
  })

  it('caches a live Jira total when no cached value is available', async () => {
    const jira = { getAllWorklogStats: jest.fn().mockResolvedValue({ count: 642, seconds: 1_234_567 }) }
    const users = {
      getCachedJiraWorklogStats: jest.fn().mockResolvedValue(null),
      cacheJiraWorklogStats: jest.fn(),
    }
    const controller = createController(jira, users)

    const result = await controller.getJiraWorklogStats({ id: 'user-1' } as never)

    expect(result).toEqual({ success: true, data: { count: 642, seconds: 1_234_567 } })
    expect(users.cacheJiraWorklogStats).toHaveBeenCalledWith('user-1', 642, 1_234_567)
  })
})