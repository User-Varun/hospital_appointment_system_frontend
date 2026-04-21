import { useEffect, useState } from "react";
import "./App.css";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api/v1";

function tryParseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function App() {
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [authView, setAuthView] = useState("login");
  const [currentUser, setCurrentUser] = useState(
    tryParseJson(localStorage.getItem("currentUser"), null),
  );
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const [registerForm, setRegisterForm] = useState({
    name: "",
    username: "",
    password: "",
    role: "patient",
    specialty: "",
  });
  const [authForm, setAuthForm] = useState({
    username: "",
    password: "",
  });
  const [bookForm, setBookForm] = useState({
    patientId: "",
    doctorId: "",
    appointmentDate: "",
    reason: "",
  });
  const [appointmentFilters, setAppointmentFilters] = useState({
    doctorId: "",
    status: "",
  });

  const [patients, setPatients] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [appointments, setAppointments] = useState([]);

  const isDoctor = currentUser?.role === "doctor";
  const isPatient = currentUser?.role === "patient";

  async function apiRequest(path, { method = "GET", body, auth = false } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (auth) {
      if (!token) {
        throw new Error("Please authenticate first.");
      }
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      const error = new Error(
        payload.message || `Request failed: ${response.status}`,
      );
      error.statusCode = response.status;
      throw error;
    }

    return payload;
  }

  async function apiRequestWithFallback(paths, options) {
    let lastError = null;

    for (let index = 0; index < paths.length; index += 1) {
      try {
        return await apiRequest(paths[index], options);
      } catch (error) {
        lastError = error;
        const hasNext = index < paths.length - 1;
        const shouldTryNext =
          error.statusCode === 404 || error.statusCode === 405;

        if (!hasNext || !shouldTryNext) {
          throw error;
        }
      }
    }

    throw lastError || new Error("Request failed");
  }

  async function runAction(action, successMessage) {
    setLoading(true);
    try {
      await action();
      setMessage(successMessage);
    } catch (error) {
      setMessage(error.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function fetchPatients() {
    const payload = await apiRequest("/users/patients", { auth: true });
    setPatients(payload.data || []);
  }

  async function fetchDoctors() {
    const payload = await apiRequest("/users/doctors", { auth: true });
    setDoctors(payload.data || []);
  }

  async function fetchAppointments(filters = appointmentFilters) {
    const params = new URLSearchParams();
    if (filters.doctorId && isPatient) params.append("doctorId", filters.doctorId);
    if (filters.status) params.append("status", filters.status);

    const query = params.toString();
    const payload = await apiRequest(
      `/appointments${query ? `?${query}` : ""}`,
      {
        auth: true,
      },
    );
    setAppointments(payload.data || []);
  }

  async function loadDashboardData(userData) {
    if (!userData) {
      return;
    }

    if (userData.role === "doctor") {
      await Promise.all([fetchPatients(), fetchDoctors(), fetchAppointments()]);
      return;
    }

    if (userData.role === "patient") {
      await Promise.all([fetchDoctors(), fetchAppointments()]);
      setPatients([]);
      return;
    }

    await Promise.all([fetchPatients(), fetchDoctors(), fetchAppointments()]);
  }

  useEffect(() => {
    if (!token || !currentUser) {
      return;
    }

    loadDashboardData(currentUser).catch((error) => {
      setMessage(error.message || "Failed to load dashboard data.");
    });
  }, [token, currentUser]);

  function handleRegister(event) {
    event.preventDefault();
    runAction(async () => {
      const body = {
        ...registerForm,
        specialty:
          registerForm.role === "doctor" ? registerForm.specialty.trim() : "",
      };
      const payload = await apiRequestWithFallback(
        ["/users/signup", "/users/register"],
        {
          method: "POST",
          body,
        },
      );
      if (payload.token && payload.data) {
        setToken(payload.token);
        setCurrentUser(payload.data);
        localStorage.setItem("token", payload.token);
        localStorage.setItem("currentUser", JSON.stringify(payload.data));
        await loadDashboardData(payload.data);
      }
      setRegisterForm({
        name: "",
        username: "",
        password: "",
        role: "patient",
        specialty: "",
      });
    }, "Signup successful.");
  }

  function handleAuthenticate(event) {
    event.preventDefault();
    runAction(async () => {
      const payload = await apiRequestWithFallback(
        ["/users/login", "/users/authenticate"],
        {
          method: "POST",
          body: authForm,
        },
      );
      setToken(payload.token);
      setCurrentUser(payload.data);
      localStorage.setItem("token", payload.token);
      localStorage.setItem("currentUser", JSON.stringify(payload.data));
      await loadDashboardData(payload.data);
    }, "Login successful.");
  }

  function handleBookAppointment(event) {
    event.preventDefault();
    runAction(
      async () => {
        const body = {
          patientId: isDoctor ? bookForm.patientId : undefined,
          doctorId: isDoctor ? currentUser?._id : bookForm.doctorId,
          appointmentDate: new Date(bookForm.appointmentDate).toISOString(),
          reason: bookForm.reason,
        };
        await apiRequest("/appointments", { method: "POST", body, auth: true });
        setBookForm({
          patientId: "",
          doctorId: "",
          appointmentDate: "",
          reason: "",
        });
        if (isPatient) {
          await fetchAppointments();
        }
        if (isDoctor) {
          await fetchAppointments();
        }
      },
      isPatient ? "Appointment request submitted." : "Appointment booked.",
    );
  }

  function handleDoctorStatusUpdate(appointmentId, status, successMessage) {
    runAction(async () => {
      await apiRequest(`/appointments/${appointmentId}/status`, {
        method: "PATCH",
        auth: true,
        body: { status },
      });
      await fetchAppointments();
    }, successMessage);
  }

  function handleRequestCancellation(appointmentId) {
    runAction(async () => {
      await apiRequestWithFallback(
        [
          `/appointments/${appointmentId}/request-cancel`,
          `/appointments/${appointmentId}/cancel-request`,
          `/appointments/${appointmentId}/request-cancellation`,
        ],
        {
          method: "PATCH",
          auth: true,
        },
      );
      await fetchAppointments();
    }, "Cancellation requested.");
  }

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("currentUser");
    setToken("");
    setCurrentUser(null);
    setPatients([]);
    setDoctors([]);
    setAppointments([]);
    setMessage("Logged out.");
  }

  if (!token) {
    return (
      <main className="auth-shell">
        <section className="card auth-card">
          <p className="eyebrow">Hospital Appointment System</p>
          <h1>{authView === "login" ? "Login" : "Sign Up"}</h1>

          <div className="button-row auth-toggle">
            <button
              type="button"
              className={authView === "login" ? "" : "secondary"}
              onClick={() => setAuthView("login")}
            >
              Login
            </button>
            <button
              type="button"
              className={authView === "signup" ? "" : "secondary"}
              onClick={() => setAuthView("signup")}
            >
              Sign Up
            </button>
          </div>

          {authView === "signup" ? (
            <form onSubmit={handleRegister} className="form auth-form">
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
                  setRegisterForm({
                    ...registerForm,
                    username: event.target.value,
                  })
                }
                placeholder="Username"
              />
              <input
                required
                type="password"
                value={registerForm.password}
                onChange={(event) =>
                  setRegisterForm({
                    ...registerForm,
                    password: event.target.value,
                  })
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
                  setRegisterForm({
                    ...registerForm,
                    specialty: event.target.value,
                  })
                }
                placeholder="Specialty (doctor only)"
              />
              <button type="submit" disabled={loading}>
                {loading ? "Please wait..." : "Sign Up"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleAuthenticate} className="form auth-form">
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
              <button type="submit" disabled={loading}>
                {loading ? "Please wait..." : "Login"}
              </button>
            </form>
          )}

          {(loading || message) && (
            <p className="auth-message">{loading ? "Working..." : message}</p>
          )}
        </section>
      </main>
    );
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
          Session:{" "}
          {currentUser
            ? `${currentUser.name} (${currentUser.role})`
            : "Not authenticated"}
        </p>
        <p>Token: {token ? "Available" : "Missing"}</p>
        {(loading || message) && <p>{loading ? "Working..." : message}</p>}
        {token && (
          <button type="button" className="secondary" onClick={handleLogout}>
            Logout
          </button>
        )}
      </section>

      <section className="grid">
        {isDoctor && (
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
              <input
                value={currentUser?.name || "Doctor"}
                disabled
                aria-label="Doctor"
              />
              <input
                required
                type="datetime-local"
                value={bookForm.appointmentDate}
                onChange={(event) =>
                  setBookForm({
                    ...bookForm,
                    appointmentDate: event.target.value,
                  })
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
              <button type="submit" disabled={loading}>
                {loading ? "Please wait..." : "Book"}
              </button>
            </form>
          </article>
        )}

        {isPatient && (
          <article className="card">
            <h2>Request Appointment</h2>
            <form onSubmit={handleBookAppointment} className="form">
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
                    {doctor.specialty ? ` - ${doctor.specialty}` : ""}
                  </option>
                ))}
              </select>
              <input
                required
                type="datetime-local"
                value={bookForm.appointmentDate}
                onChange={(event) =>
                  setBookForm({
                    ...bookForm,
                    appointmentDate: event.target.value,
                  })
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
              <button type="submit" disabled={loading}>
                {loading ? "Please wait..." : "Request Appointment"}
              </button>
            </form>
          </article>
        )}
      </section>

      {isPatient && (
        <section className="card wide-card">
          <h2>My Appointments</h2>
          <div className="filter-row">
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
              <option value="appointment_requested">
                Appointment Requested
              </option>
              <option value="booked">Booked</option>
              <option value="cancellation_requested">
                Cancellation Requested
              </option>
              <option value="cancelled">Cancelled</option>
            </select>

            <button
              type="button"
              onClick={() =>
                runAction(
                  () => fetchAppointments(appointmentFilters),
                  "Appointments loaded.",
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
                      <td>
                        {new Date(appointment.appointmentDate).toLocaleString()}
                      </td>
                      <td>{appointment.patient?.name || "Unknown"}</td>
                      <td>{appointment.doctor?.name || "Unknown"}</td>
                      <td>
                        <span
                          className={`status-pill ${
                            appointment.status === "cancelled"
                              ? "status-cancelled"
                              : appointment.status === "appointment_requested"
                                ? "status-appointment-requested"
                                : appointment.status ===
                                    "cancellation_requested"
                                  ? "status-requested"
                                  : "status-booked"
                          }`}
                        >
                          {appointment.status}
                        </span>
                      </td>
                      <td>{appointment.reason || "-"}</td>
                      <td>
                        <button
                          type="button"
                          className="secondary"
                          disabled={
                            appointment.status === "cancelled" ||
                            appointment.status === "cancellation_requested"
                          }
                          onClick={() =>
                            handleRequestCancellation(appointment._id)
                          }
                        >
                          Request Cancel
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {isDoctor && (
        <section className="card wide-card">
          <h2>My Appointment Queue</h2>
          <div className="filter-row">
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
              <option value="appointment_requested">
                Pending Appointment Requests
              </option>
              <option value="booked">Booked</option>
              <option value="cancellation_requested">
                Pending Cancellation Requests
              </option>
              <option value="cancelled">Cancelled</option>
            </select>

            <button
              type="button"
              onClick={() =>
                runAction(
                  () => fetchAppointments(appointmentFilters),
                  "Appointments loaded.",
                )
              }
            >
              Refresh Queue
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
                  <th>Actions</th>
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
                      <td>
                        {new Date(appointment.appointmentDate).toLocaleString()}
                      </td>
                      <td>{appointment.patient?.name || "Unknown"}</td>
                      <td>{appointment.doctor?.name || "Unknown"}</td>
                      <td>
                        <span
                          className={`status-pill ${
                            appointment.status === "cancelled"
                              ? "status-cancelled"
                              : appointment.status === "appointment_requested"
                                ? "status-appointment-requested"
                                : appointment.status ===
                                    "cancellation_requested"
                                  ? "status-requested"
                                  : "status-booked"
                          }`}
                        >
                          {appointment.status}
                        </span>
                      </td>
                      <td>{appointment.reason || "-"}</td>
                      <td>
                        <div className="button-row">
                          {appointment.status === "appointment_requested" && (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  handleDoctorStatusUpdate(
                                    appointment._id,
                                    "booked",
                                    "Appointment request approved.",
                                  )
                                }
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                className="secondary"
                                onClick={() =>
                                  handleDoctorStatusUpdate(
                                    appointment._id,
                                    "cancelled",
                                    "Appointment request rejected.",
                                  )
                                }
                              >
                                Reject
                              </button>
                            </>
                          )}

                          {appointment.status === "booked" && (
                            <button
                              type="button"
                              className="secondary"
                              onClick={() =>
                                handleDoctorStatusUpdate(
                                  appointment._id,
                                  "cancelled",
                                  "Appointment cancelled.",
                                )
                              }
                            >
                              Cancel
                            </button>
                          )}

                          {appointment.status === "cancellation_requested" && (
                            <>
                              <button
                                type="button"
                                className="secondary"
                                onClick={() =>
                                  handleDoctorStatusUpdate(
                                    appointment._id,
                                    "booked",
                                    "Cancellation request declined.",
                                  )
                                }
                              >
                                Keep Appointment
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleDoctorStatusUpdate(
                                    appointment._id,
                                    "cancelled",
                                    "Cancellation request approved.",
                                  )
                                }
                              >
                                Approve Cancel
                              </button>
                            </>
                          )}

                          {appointment.status === "cancelled" && "-"}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

export default App;
