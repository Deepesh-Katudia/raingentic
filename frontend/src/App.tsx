import { Route, Routes } from 'react-router-dom'
import Landing from '@/pages/Landing'
import Chat from '@/pages/Chat'
import Overview from '@/pages/admin/Overview'
import Ledger from '@/pages/admin/Ledger'
import SpendAgent from '@/pages/admin/SpendAgent'
import AdminGate from '@/components/AdminGate'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/chat/:agentId" element={<Chat />} />
      <Route
        path="/admin"
        element={
          <AdminGate>
            <Overview />
          </AdminGate>
        }
      />
      <Route
        path="/admin/ledger"
        element={
          <AdminGate>
            <Ledger />
          </AdminGate>
        }
      />
      <Route
        path="/admin/spend"
        element={
          <AdminGate>
            <SpendAgent />
          </AdminGate>
        }
      />
    </Routes>
  )
}

export default App
