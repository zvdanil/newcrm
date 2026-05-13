import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppLayout } from './components/Layout/AppLayout'
import { ProtectedRoute } from './components/ProtectedRoute'
import { LoginPage } from './pages/Login/LoginPage'
import { ChildrenListPage } from './pages/Children/ChildrenListPage'
import { ChildCardPage } from './pages/Children/ChildCardPage'
import { ChildCreatePage } from './pages/Children/ChildCreatePage'
import { FamiliesListPage } from './pages/Families/FamiliesListPage'
import { FamilyCardPage } from './pages/Families/FamilyCardPage'
import { FamilyCreatePage } from './pages/Families/FamilyCreatePage'
import { GroupsPage } from './pages/Groups/GroupsPage'
import { AccountsPage } from './pages/Accounts/AccountsPage'
import { AccountCardPage } from './pages/Accounts/AccountCardPage'
import { ActivitiesListPage } from './pages/Activities/ActivitiesListPage'
import { ActivityCreatePage } from './pages/Activities/ActivityCreatePage'
import { ActivityCardPage } from './pages/Activities/ActivityCardPage'
import { JournalsListPage } from './pages/Journals/JournalsListPage'
import { JournalPage } from './pages/Journals/JournalPage'
import { MergedJournalPage } from './pages/Journals/MergedJournalPage'
import { ExpensesPage } from './pages/Expenses/ExpensesPage'
import { StaffListPage } from './pages/Staff/StaffListPage'
import { StaffCardPage } from './pages/Staff/StaffCardPage'
import { SalaryJournalPage } from './pages/Salary/SalaryJournalPage'
import { CalendarPage } from './pages/Calendar/CalendarPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
})

function Placeholder({ title }: { title: string }) {
  return (
    <div className="py-12 text-center">
      <p className="text-gray-400 text-sm">{title} — буде реалізовано в наступних етапах</p>
    </div>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route index element={<Navigate to="/children" replace />} />

              {/* Діти */}
              <Route path="children"      element={<ChildrenListPage />} />
              <Route path="children/new"  element={<ChildCreatePage />} />
              <Route path="children/:id"  element={<ChildCardPage />} />

              {/* Сім'ї */}
              <Route path="families"      element={<FamiliesListPage />} />
              <Route path="families/new"  element={<FamilyCreatePage />} />
              <Route path="families/:id"  element={<FamilyCardPage />} />

              {/* Групи */}
              <Route path="groups" element={<GroupsPage />} />

              {/* Рахунки */}
              <Route path="accounts" element={<AccountsPage />} />
              <Route path="accounts/:id" element={<AccountCardPage />} />

              {/* Активності */}
              <Route path="activities"      element={<ActivitiesListPage />} />
              <Route path="activities/new"  element={<ActivityCreatePage />} />
              <Route path="activities/:id"  element={<ActivityCardPage />} />

              {/* Журнали */}
              <Route path="journals"                    element={<JournalsListPage />} />
              <Route path="journals/merged/:id"         element={<MergedJournalPage />} />
              <Route path="journals/:activityId"        element={<JournalPage />} />
              {/* Витрати */}
              <Route path="expenses" element={<ExpensesPage />} />

              {/* Персонал */}
              <Route path="staff"       element={<StaffListPage />} />
              <Route path="staff/:id"   element={<StaffCardPage />} />

              {/* Зарплата */}
              <Route path="salary/journal" element={<SalaryJournalPage />} />

              {/* Календар */}
              <Route path="calendar" element={<CalendarPage />} />

              <Route path="reports"   element={<Placeholder title="Звіти" />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
