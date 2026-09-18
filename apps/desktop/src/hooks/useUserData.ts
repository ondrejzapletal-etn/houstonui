import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../store/authStore'
import { fetchClients } from '../services/projectsClient'
import { fetchProjects } from '../services/projectsClient'
import { searchIssues } from '../services/projectsClient'
import { fetchAllCalendarLinks } from '../services/projectsClient'
import type { ClientDto, ProjectDto, JiraIssueDto, CalendarIssueLinkDto } from '@houston/shared-types'

export function useClients() {
  const accessToken = useAuthStore((s) => s.accessToken)
  return useQuery<ClientDto[]>({
    queryKey: ['clients'],
    queryFn: () => fetchClients(accessToken),
    staleTime: 60_000,
  })
}

export function useProjects() {
  const accessToken = useAuthStore((s) => s.accessToken)
  return useQuery<ProjectDto[]>({
    queryKey: ['projects'],
    queryFn: () => fetchProjects(accessToken),
    staleTime: 60_000,
  })
}

export function useAllIssues() {
  const accessToken = useAuthStore((s) => s.accessToken)
  return useQuery<JiraIssueDto[]>({
    queryKey: ['issues', 'all'],
    queryFn: () => searchIssues(accessToken),
    staleTime: 60_000,
  })
}

export function useAllCalendarLinks() {
  const accessToken = useAuthStore((s) => s.accessToken)
  return useQuery<CalendarIssueLinkDto[]>({
    queryKey: ['calendar-links', 'all'],
    queryFn: () => fetchAllCalendarLinks(accessToken),
    staleTime: 30_000,
  })
}
