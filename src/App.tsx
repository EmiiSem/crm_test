import { Navigate, Route, Routes } from 'react-router-dom'
import { AssignerRoute, ExecutorRoute, ProtectedRoute } from './auth/guards'
import { Layout } from './components/Layout'
import { LoginPage } from './pages/LoginPage'
import { MyTasksPage } from './pages/MyTasksPage'
import { ObjectFormPage } from './pages/ObjectFormPage'
import { ObjectPage } from './pages/ObjectPage'
import { ObjectsPage } from './pages/ObjectsPage'
import { TaskFormPage } from './pages/TaskFormPage'
import { TaskPage } from './pages/TaskPage'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/objects" replace />} />
          <Route path="/objects" element={<ObjectsPage />} />
          <Route path="/objects/:objectId" element={<ObjectPage />} />
          <Route path="/tasks/:taskId" element={<TaskPage />} />
          <Route element={<AssignerRoute />}>
            <Route path="/objects/new" element={<ObjectFormPage />} />
            <Route path="/objects/:objectId/edit" element={<ObjectFormPage />} />
            <Route path="/objects/:objectId/tasks/new" element={<TaskFormPage />} />
            <Route path="/tasks/:taskId/edit" element={<TaskFormPage />} />
          </Route>
          <Route element={<ExecutorRoute />}>
            <Route path="/my-tasks" element={<MyTasksPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/objects" replace />} />
        </Route>
      </Route>
    </Routes>
  )
}
