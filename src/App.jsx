import { useState } from 'react'
import './App.css'

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1'

function tryParseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '')
  const [currentUser, setCurrentUser] = useState(
    tryParseJson(localStorage.getItem('currentUser'), null),
  )
  const [message, setMessage] = useState('Ready')
  const [loading, setLoading] = useState(false)

  const [registerForm, setRegisterForm] = useState({
    name: '',
    username: '',
    password: '',
    role: 'patient',
    specialty: '',
  })
  const [authForm, setAuthForm] = useState({
    username: '',
    password: '',
  })
  const [bookForm, setBookForm] = useState({
    patientId: '',
    doctorId: '',
    appointmentDate: '',
    reason: '',
  })
  const [appointmentFilters, setAppointmentFilters] = useState({
    patientId: '',
    doctorId: '',
    status: '',
  })

  const [users, setUsers] = useState([])
  const [patients, setPatients] = useState([])
  const [doctors, setDoctors] = useState([])
  const [appointments, setAppointments] = useState([])

  async function apiRequest(path, { method = 'GET', body, auth = false } = {}) {
    const headers = { 'Content-Type': 'application/json' }
    if (auth) {
      if (!token) {
        throw new Error('Please authenticate first.')
      }
      headers.Authorization = `Bearer ${token}`
    }

    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok || payload.success === false) {
      const error = new Error(
        payload.message || `Request failed: ${response.status}`,
      )
      error.statusCode = response.status
      throw error
    }

    return payload
  }

  async function apiRequestWithFallback(paths, options) {
    let lastError = null

    for (let index = 0; index < paths.length; index += 1) {
      try {
        return await apiRequest(paths[index], options)
      } catch (error) {
        lastError = error
        const hasNext = index < paths.length - 1
        const shouldTryNext = error.statusCode === 404 || error.statusCode === 405

        if (!hasNext || !shouldTryNext) {
          throw error
        }
      }
    }

    throw lastError || new Error('Request failed')
  }

  async function runAction(action, successMessage) {
    setLoading(true)
    try {
      await action()
      setMessage(successMessage)
    } catch (error) {
      setMessage(error.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  async function fetchPatients() {
    const payload = await apiRequest('/users/patients', { auth: true })
    setPatients(payload.data || [])
  }

  async function fetchDoctors() {
    const payload = await apiRequest('/users/doctors', { auth: true })
    setDoctors(payload.data || [])
  }

  async function fetchUsers() {
    const payload = await apiRequest('/users', { auth: true })
    setUsers(payload.data || [])
  }

  async function fetchAppointments(filters = appointmentFilters) {
    const params = new URLSearchParams()
    if (filters.patientId) params.append('patientId', filters.patientId)
    if (filters.doctorId) params.append('doctorId', filters.doctorId)
    if (filters.status) params.append('status', filters.status)

    const query = params.toString()
    const payload = await apiRequest(`/appointments${query ? `?${query}` : ''}`, {
      auth: true,
    })
    setAppointments(payload.data || [])
  }

  function handleRegister(event) {
    event.preventDefault()
    runAction(async () => {
      const body = {
        ...registerForm,
        specialty:
          registerForm.role === 'doctor' ? registerForm.specialty.trim() : '',
      }
      const payload = await apiRequestWithFallback(
        ['/users/signup', '/users/register'],
        {
          method: 'POST',
          body,
        },
      )
      if (payload.token && payload.data) {
        setToken(payload.token)
        setCurrentUser(payload.data)
        localStorage.setItem('token', payload.token)
        localStorage.setItem('currentUser', JSON.stringify(payload.data))
      }
      setRegisterForm({
        name: '',
        username: '',
        password: '',
        role: 'patient',
        specialty: '',
      })
      await Promise.all([fetchPatients(), fetchDoctors(), fetchAppointments()])
    }, 'Signup successful.')
  }

  function handleAuthenticate(event) {
    event.preventDefault()
    runAction(async () => {
      const payload = await apiRequestWithFallback(
        ['/users/login', '/users/authenticate'],
        {
          method: 'POST',
          body: authForm,
        },
      )
      setToken(payload.token)
      setCurrentUser(payload.data)
      localStorage.setItem('token', payload.token)
      localStorage.setItem('currentUser', JSON.stringify(payload.data))
      await Promise.all([fetchPatients(), fetchDoctors(), fetchAppointments()])
    }, 'Login successful.')
  }

  function handleBookAppointment(event) {
    event.preventDefault()
    runAction(async () => {
      const body = {
        ...bookForm,
        appointmentDate: new Date(bookForm.appointmentDate).toISOString(),
      }
      await apiRequest('/appointments', { method: 'POST', body, auth: true })
      await fetchAppointments()
      setBookForm({
        patientId: '',
        doctorId: '',
        appointmentDate: '',
        reason: '',
      })
    }, 'Appointment booked.')
  }

  function handleCancelAppointment(appointmentId) {
    runAction(async () => {
      await apiRequest(`/appointments/${appointmentId}/cancel`, {
        method: 'PATCH',
        auth: true,
      })
      await fetchAppointments()
    }, 'Appointment cancelled.')
  }

  function handleLogout() {
    localStorage.removeItem('token')
    localStorage.removeItem('currentUser')
    setToken('')
    setCurrentUser(null)
    setUsers([])
    setPatients([])
    setDoctors([])
    setAppointments([])
    setMessage('Logged out.')
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <p className="eyebrow">Hospital Appointment System</p>
          <h1>Appointment Dashboard</h1>
        </div>
      </header>

      <section className="status-row">
        <p>
          Session:{' '}
          {currentUser
            ? `${currentUser.name} (${currentUser.role})`
            : 'Not authenticated'}
        </p>
        <p>Token: {token ? 'Available' : 'Missing'}</p>
        <p>{loading ? 'Working...' : message}</p>
        {token && (
          <button type="button" className="secondary" onClick={handleLogout}>
            Logout
          </button>
        )}
      </section>

      <section className="grid">
        <article className="card">
          <h2>Sign Up Patient / Doctor</h2>
          <form onSubmit={handleRegister} className="form">
            <input
              required
              value={registerForm.name}
              onChange={(event) =>
                setRegisterForm({ ...registerForm, name: event.target.value })
              }
              placeholder="Name"
            />
            <input
              required
              value={registerForm.username}
              onChange={(event) =>
                setRegisterForm({ ...registerForm, username: event.target.value })
              }
              placeholder="Username"
            />
            <input
              required
              type="password"
              value={registerForm.password}
              onChange={(event) =>
                setRegisterForm({ ...registerForm, password: event.target.value })
              }
              placeholder="Password"
            />
            <select
              value={registerForm.role}
              onChange={(event) =>
                setRegisterForm({ ...registerForm, role: event.target.value })
              }
            >
              <option value="patient">Patient</option>
              <option value="doctor">Doctor</option>
            </select>
            <input
              value={registerForm.specialty}
              onChange={(event) =>
                setRegisterForm({ ...registerForm, specialty: event.target.value })
              }
              placeholder="Specialty (doctor only)"
            />
            <button type="submit">Sign Up</button>
          </form>
        </article>

        <article className="card">
          <h2>Login</h2>
          <form onSubmit={handleAuthenticate} className="form">
            <input
              required
              value={authForm.username}
              onChange={(event) =>
                setAuthForm({ ...authForm, username: event.target.value })
              }
              placeholder="Username"
            />
            <input
              required
              type="password"
              value={authForm.password}
              onChange={(event) =>
                setAuthForm({ ...authForm, password: event.target.value })
              }
              placeholder="Password"
            />
            <button type="submit">Login</button>
          </form>
        </article>

        <article className="card">
          <h2>Get Users</h2>
          <div className="button-row">
            <button
              type="button"
              onClick={() => runAction(fetchUsers, 'All users loaded.')}
            >
              Get All Users
            </button>
            <button
              type="button"
              onClick={() => runAction(fetchPatients, 'Patients loaded.')}
            >
              Get Patients
            </button>
            <button
              type="button"
              onClick={() => runAction(fetchDoctors, 'Doctors loaded.')}
            >
              Get Doctors
            </button>
          </div>
        </article>

        <article className="card">
          <h2>Book Appointment</h2>
          <form onSubmit={handleBookAppointment} className="form">
            <select
              required
              value={bookForm.patientId}
              onChange={(event) =>
                setBookForm({ ...bookForm, patientId: event.target.value })
              }
            >
              <option value="">Select patient</option>
              {patients.map((patient) => (
                <option key={patient._id} value={patient._id}>
                  {patient.name} ({patient.username})
                </option>
              ))}
            </select>
            <select
              required
              value={bookForm.doctorId}
              onChange={(event) =>
                setBookForm({ ...bookForm, doctorId: event.target.value })
              }
            >
              <option value="">Select doctor</option>
              {doctors.map((doctor) => (
                <option key={doctor._id} value={doctor._id}>
                  {doctor.name}
                  {doctor.specialty ? ` - ${doctor.specialty}` : ''}
                </option>
              ))}
            </select>
            <input
              required
              type="datetime-local"
              value={bookForm.appointmentDate}
              onChange={(event) =>
                setBookForm({ ...bookForm, appointmentDate: event.target.value })
              }
            />
            <textarea
              value={bookForm.reason}
              onChange={(event) =>
                setBookForm({ ...bookForm, reason: event.target.value })
              }
              placeholder="Reason"
              rows="3"
            />
            <button type="submit">Book</button>
          </form>
        </article>
      </section>

      <section className="card wide-card">
        <h2>Get / Cancel Appointments</h2>
        <div className="filter-row">
          <select
            value={appointmentFilters.patientId}
            onChange={(event) =>
              setAppointmentFilters({
                ...appointmentFilters,
                patientId: event.target.value,
              })
            }
          >
            <option value="">All patients</option>
            {patients.map((patient) => (
              <option key={patient._id} value={patient._id}>
                {patient.name}
              </option>
            ))}
          </select>

          <select
            value={appointmentFilters.doctorId}
            onChange={(event) =>
              setAppointmentFilters({
                ...appointmentFilters,
                doctorId: event.target.value,
              })
            }
          >
            <option value="">All doctors</option>
            {doctors.map((doctor) => (
              <option key={doctor._id} value={doctor._id}>
                {doctor.name}
              </option>
            ))}
          </select>

          <select
            value={appointmentFilters.status}
            onChange={(event) =>
              setAppointmentFilters({
                ...appointmentFilters,
                status: event.target.value,
              })
            }
          >
            <option value="">Any status</option>
            <option value="booked">Booked</option>
            <option value="cancelled">Cancelled</option>
          </select>

          <button
            type="button"
            onClick={() =>
              runAction(
                () => fetchAppointments(appointmentFilters),
                'Appointments loaded.',
              )
            }
          >
            Refresh Appointments
          </button>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Patient</th>
                <th>Doctor</th>
                <th>Status</th>
                <th>Reason</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {appointments.length === 0 ? (
                <tr>
                  <td colSpan="6">No appointments found.</td>
                </tr>
              ) : (
                appointments.map((appointment) => (
                  <tr key={appointment._id}>
                    <td>{new Date(appointment.appointmentDate).toLocaleString()}</td>
                    <td>{appointment.patient?.name || 'Unknown'}</td>
                    <td>{appointment.doctor?.name || 'Unknown'}</td>
                    <td>
                      <span
                        className={`status-pill ${
                          appointment.status === 'cancelled'
                            ? 'status-cancelled'
                            : 'status-booked'
                        }`}
                      >
                        {appointment.status}
                      </span>
                    </td>
                    <td>{appointment.reason || '-'}</td>
                    <td>
                      <button
                        type="button"
                        className="secondary"
                        disabled={appointment.status === 'cancelled'}
                        onClick={() => handleCancelAppointment(appointment._id)}
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid lists-grid">
        <article className="card">
          <h2>Patients</h2>
          <ul className="list">
            {patients.length === 0 ? (
              <li>No patients loaded.</li>
            ) : (
              patients.map((patient) => (
                <li key={patient._id}>
                  {patient.name} ({patient.username})
                </li>
              ))
            )}
          </ul>
        </article>

        <article className="card">
          <h2>Doctors</h2>
          <ul className="list">
            {doctors.length === 0 ? (
              <li>No doctors loaded.</li>
            ) : (
              doctors.map((doctor) => (
                <li key={doctor._id}>
                  {doctor.name}
                  {doctor.specialty ? ` (${doctor.specialty})` : ''}
                </li>
              ))
            )}
          </ul>
        </article>

        <article className="card">
          <h2>All Users</h2>
          <ul className="list">
            {users.length === 0 ? (
              <li>No users loaded.</li>
            ) : (
              users.map((user) => (
                <li key={user._id}>
                  {user.name} ({user.role})
                </li>
              ))
            )}
          </ul>
        </article>
      </section>
    </main>
  )
}

export default App
