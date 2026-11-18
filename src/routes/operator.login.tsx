import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/brand/Logo";
import { supabase } from "@/integrations/supabase/client";
import { useOperatorAuth } from "@/hooks/use-operator-auth";

export const Route = createFileRoute("/operator/login")({
  component: OperatorLogin,
});

function OperatorLogin() {
  const navigate = useNavigate();
  const auth = useOperatorAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (auth.status === "operator") navigate({ to: "/operator/hoy" });
  }, [auth.status, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setSubmitting(false);
    if (signInErr) {
      setError("No pudimos iniciar sesión. Revisá tus datos.");
      return;
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-3 text-center">
          <div className="flex justify-center">
            <Logo />
          </div>
          <CardTitle>Washero Driver</CardTitle>
          <p className="text-sm text-muted-foreground">Acceso para lavadores y operadores en campo.</p>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="op-email">Email</Label>
              <Input
                id="op-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="op-password">Contraseña</Label>
              <Input
                id="op-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={submitting}
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Ingresar
            </Button>
          </form>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            ¿Sos admin?{" "}
            <Link to="/admin/login" className="text-primary underline-offset-2 hover:underline">
              Panel admin
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
