import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Router, Route, Switch } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider } from "@/contexts/AuthContext";
import Home from "@/pages/Home";
import LoginPage from "@/pages/Login";
import AdminDashboard from "@/pages/admin/AdminDashboard";
import TeacherDashboard from "@/pages/teacher/TeacherDashboard";
import StudentDashboard from "@/pages/student/StudentDashboard";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

// Use hash-based routing (/#/) to support opening index.html directly via file:// protocol
// Tolerant routing: unmatched paths are treated as anchor sections (e.g., /#/services → scroll to #services)
// For in-page anchors, use <Link href="/section"> instead of <a href="#section">
function Gate() {
  const { loading, user, logout } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-muted-foreground">載入中…</div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className="min-h-screen bg-muted/20">
      <div className="sticky top-0 z-10 border-b bg-background/70 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between relative">
          <div className="pointer-events-none absolute inset-0 -z-10 opacity-40" style={{
            backgroundImage:
              "radial-gradient(circle at 10% 20%, oklch(0.92 0.12 80), transparent 35%), radial-gradient(circle at 80% 0%, oklch(0.92 0.12 30), transparent 40%), radial-gradient(circle at 75% 90%, oklch(0.92 0.12 210), transparent 45%)",
          }} />
          <div>
            <div className="font-semibold">青山國小圖書列車</div>
            <div className="text-xs text-muted-foreground">{user.name}（{user.role}）｜布可列車管理</div>
          </div>
          <Button variant="outline" onClick={logout}>登出</Button>
        </div>
      </div>

      <div className="mx-auto max-w-6xl">
        {user.role === "admin" && <AdminDashboard />}
        {user.role === "teacher" && <TeacherDashboard />}
        {user.role === "student" && <StudentDashboard />}
      </div>
    </div>
  );
}

function AppRouter() {
  return (
    <Router hook={useHashLocation}>
      <Switch>
        <Route path="/"> <Gate /> </Route>
        <Route path="/home">{() => <Home />}</Route>
        <Route>{() => <Gate />}</Route>
      </Switch>
    </Router>
  );
}

// Note on theming:
// - Choose defaultTheme based on your design (light or dark background)
// - Update the color palette in index.css to match
// - If you want switchable themes, add `switchable` prop and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <AppRouter />
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;

