import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Navigate, Outlet } from 'react-router-dom'
import type { AppModule } from '../createRouter'
import { ConfigHealthReportPage } from './ConfigHealthReportPage'
import { NotificationsRoot } from './components/Notifications'
import { HomePage } from './HomePage'
import { ConfigModelsProvider } from './hooks/useConfigModels'
import { NewProjectPage } from './NewProjectPage'
// DIVERGENCE(mev): standalone trace deep-link page (M4)
import { TracePage } from './panel-trace/TracePage'
import { ProjectPage } from './ProjectPage'
import { RendererBenchPage } from './RendererBenchPage'

const queryClient = new QueryClient()

export const DiscoveryAppModule: AppModule = {
  name: 'discovery',
  routes: [
    {
      path: '/',
      element: <Navigate to="/ui" replace />,
    },
    {
      path: '/ui',
      element: (
        <QueryClientProvider client={queryClient}>
          <Outlet />
        </QueryClientProvider>
      ),
      children: [
        {
          index: true,
          element: <HomePage />,
        },
        {
          path: 'p/:project',
          element: (
            <ConfigModelsProvider>
              <NotificationsRoot />
              <ProjectPage />
            </ConfigModelsProvider>
          ),
        },
        {
          path: 'new',
          element: <NewProjectPage />,
        },
        // DIVERGENCE(mev): trace deep links from the MEV explorer (M4);
        // with a resolved synthetic project the same page docks the full
        // workspace (ADR-008) - the nested :project param is what the stock
        // project-scoped panels read via useParams()
        {
          path: 'trace',
          element: <TracePage />,
        },
        {
          path: 'trace/:txHash',
          element: <TracePage />,
        },
        {
          path: 'trace/:txHash/:project',
          element: (
            <ConfigModelsProvider>
              <NotificationsRoot />
              <TracePage />
            </ConfigModelsProvider>
          ),
        },
        {
          path: 'reports/config-health',
          element: <ConfigHealthReportPage />,
        },
        {
          path: 'node-view-bench',
          element: <RendererBenchPage />,
        },
      ],
    },
  ],
}
