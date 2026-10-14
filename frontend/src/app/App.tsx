import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Spinner } from '../components/ui';
import { Applications } from '../pages/Applications';
import { Approvals } from '../pages/Approvals';
import { Cv } from '../pages/Cv';
import { Dashboard } from '../pages/Dashboard';
import { Integrations } from '../pages/Integrations';
import { JobDetail } from '../pages/JobDetail';
import { Jobs } from '../pages/Jobs';
import { Login } from '../pages/Login';
import { Preferences } from '../pages/Preferences';
import { Sources } from '../pages/Sources';
import { useAuth } from './auth';
import { Layout } from './Layout';

export function App() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  return (
    <BrowserRouter>
      <Routes>
        {!user ? (
          <Route path="*" element={<Login />} />
        ) : (
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="jobs" element={<Jobs />} />
            <Route path="jobs/:id" element={<JobDetail />} />
            <Route path="approvals" element={<Approvals />} />
            <Route path="applications" element={<Applications />} />
            <Route path="sources" element={<Sources />} />
            <Route path="cv" element={<Cv />} />
            <Route path="preferences" element={<Preferences />} />
            <Route path="integrations" element={<Integrations />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        )}
      </Routes>
    </BrowserRouter>
  );
}
