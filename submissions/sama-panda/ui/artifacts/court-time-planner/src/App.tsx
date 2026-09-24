import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

import { Layout } from '@/components/layout';
import { ScheduleProvider } from '@/store/schedule-context';
import NotFound from '@/pages/not-found';

import DashboardPage from '@/pages/dashboard';
import CalendarPage from '@/pages/calendar';
import RosterPage from '@/pages/roster';
import CaseDetailPage from '@/pages/case-detail';
import PrioritiesPage from '@/pages/priorities';
import CauseListPage from '@/pages/cause-list';
import ImpactPage from '@/pages/impact';
import FinalisePage from '@/pages/finalise';
import EligibilityPage from '@/pages/eligibility';
import RegistryQueuePage from '@/pages/registry-queue';
import DefectPolicyPage from '@/pages/defect-policy';

const queryClient = new QueryClient();

function Router() {
  return (
    <RoutedErrorBoundary>
      <Layout>
        <Switch>
          <Route path="/" component={DashboardPage} />
          <Route path="/calendar" component={CalendarPage} />
          <Route path="/roster" component={RosterPage} />
          <Route path="/roster/:id" component={CaseDetailPage} />
          <Route path="/priorities" component={PrioritiesPage} />
          <Route path="/cause-list" component={CauseListPage} />
          <Route path="/impact" component={ImpactPage} />
          <Route path="/finalise" component={FinalisePage} />
          <Route path="/eligibility" component={EligibilityPage} />
          <Route path="/registry" component={RegistryQueuePage} />
          <Route path="/policy" component={DefectPolicyPage} />
          <Route component={NotFound} />
        </Switch>
      </Layout>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ScheduleProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </ScheduleProvider>
    </QueryClientProvider>
  );
}

export default App;