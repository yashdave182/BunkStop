// src/pages/Auth.tsx
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { GraduationCap, X } from 'lucide-react';

// -------------------- Types --------------------
type CatalogItem = { code: string; name: string; default_total: number | null };
type ChosenSubject = { code: string; name: string; total: number };

// LocalStorage key used for deferred onboarding
const PENDING_KEY = 'pending_subject_setup_v1';

// -------------------- Component --------------------
const Auth = () => {
  // -------------------- State --------------------
  const [isLogin, setIsLogin] = useState(true); // Toggle between Login / Signup

  // Form fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  // Catalog state
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Subjects chosen by user
  const [chosen, setChosen] = useState<ChosenSubject[]>([]);

  // Misc UI states
  const [loading, setLoading] = useState(false);
  const [subjectsLocked, setSubjectsLocked] = useState(false); // Lock after signup until verification

  // Hooks
  const { signUp, signIn, user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  // -------------------- Load catalog from DB --------------------
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('subjects_catalog')
        .select('code, name, default_total')
        .eq('is_active', true)
        .order('code', { ascending: true });

      if (error) {
        setCatalogError(error.message || 'Failed to load subjects');
      } else {
        setCatalogError(null);
        setCatalog(data || []);
      }
    })();
  }, []);

  // -------------------- Auto redirect if logged in --------------------
  useEffect(() => {
    if (!user) return;
    const hasPending = !!localStorage.getItem(PENDING_KEY);
    if (!hasPending) navigate('/dashboard', { replace: true });
  }, [user, navigate]);

  // -------------------- Run onboarding after email verification --------------------
  useEffect(() => {
    const run = async () => {
      if (!user) return;
      const raw = localStorage.getItem(PENDING_KEY);
      if (!raw) return;

      try {
        const data = JSON.parse(raw) as { name: string; codes: string[]; totals: number[] };

        // Run RPC that handles both profile + totals atomically
        // Get current session to extract the authenticated user's ID
        const { data: { session } } = await supabase.auth.getSession();
console.log("Session user id:", session?.user?.id);

const { error: rpcErr } = await supabase.rpc('complete_onboarding_v2', {
  p_uid: session?.user?.id,
  p_name: data.name,
  p_subjects: data.codes,
  p_totals: data.totals,
});

if (rpcErr) {
  console.error("RPC error:", rpcErr);
  throw rpcErr;
}


        localStorage.removeItem(PENDING_KEY);

        // Force refresh so subjects show up immediately on first login
        await supabase.auth.refreshSession();

        toast({ title: 'Welcome!', description: 'Your subjects were saved.' });
        navigate('/dashboard', { replace: true });
      } catch (e: any) {
        toast({
          title: 'Setup failed',
          description: e?.message || 'Could not complete onboarding.',
          variant: 'destructive',
        });
        localStorage.removeItem(PENDING_KEY);
        navigate('/dashboard', { replace: true });
      }
    };
    run();
  }, [user, navigate, toast]);

  // -------------------- Catalog filtering --------------------
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const picked = new Set(chosen.map(c => c.code));
    return catalog
      .filter(c => !picked.has(c.code))
      .filter(c => q === '' || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
      .slice(0, 10);
  }, [query, catalog, chosen]);

  // -------------------- Subject manipulation --------------------
  const addSubject = (c: CatalogItem) => {
    if (subjectsLocked) return;
    const defaultTotal = c.default_total ?? 20;
    setChosen(prev => [...prev, { code: c.code, name: c.name, total: defaultTotal }]);
    setQuery('');
  };

  const removeSubject = (code: string) => {
    if (subjectsLocked) return;
    setChosen(prev => prev.filter(s => s.code !== code));
  };

  const updateTotal = (code: string, value: string) => {
    if (subjectsLocked) return;
    const n = Number(value);
    setChosen(prev =>
      prev.map(s =>
        s.code === code
          ? { ...s, total: !Number.isFinite(n) || n < 0 ? 0 : Math.floor(n) }
          : s
      ),
    );
  };

  // -------------------- Form submit (Signup/Login) --------------------
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        // -------------------- LOGIN --------------------
        const { error } = await signIn(email, password);
        if (error) throw error;
        navigate('/dashboard');
        return;
      }

      // -------------------- SIGNUP --------------------
      if (!name.trim()) {
        toast({ title: 'Missing name', description: 'Enter your full name.', variant: 'destructive' });
        return;
      }
      if (chosen.length === 0) {
        toast({ title: 'Pick subjects', description: 'Add at least one subject.', variant: 'destructive' });
        return;
      }

      const { error } = await signUp(email, password, name);
      if (error) throw error;

      // Always defer onboarding until email verification
      const codes = chosen.map(s => s.code);
      const totals = chosen.map(s => s.total);
      localStorage.setItem(PENDING_KEY, JSON.stringify({ name: name.trim(), codes, totals }));

      toast({
        title: 'Verify your email',
        description: 'After verification, your subjects will be saved automatically.',
      });

      setSubjectsLocked(true); // prevent changing subjects until verified
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Something went wrong.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // -------------------- JSX --------------------
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl shadow-xl">
        {/* Header */}
        <CardHeader className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="p-3 bg-primary rounded-full">
              <GraduationCap className="h-8 w-8 text-primary-foreground" />
            </div>
          </div>
          <div>
            <CardTitle className="text-2xl font-bold">Student Attendance</CardTitle>
            <CardDescription>
              {isLogin ? 'Sign in to track your attendance' : 'Create your account and add your subjects'}
            </CardDescription>
          </div>
        </CardHeader>

        {/* Content */}
        <CardContent className="space-y-6">
          {/* Auth Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Signup only: Name */}
            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  required
                />
              </div>
            )}

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>

            {/* Password */}
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                minLength={6}
                required
              />
            </div>

            {/* Signup-only: Subject selection */}
            {!isLogin && (
              <div className="space-y-3">
                <Label className="text-base">Add Subjects</Label>

                {/* Search field */}
                <Input
                  placeholder="Search by code or name…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  disabled={subjectsLocked}
                />

                {/* Catalog error */}
                {catalogError && (
                  <div className="text-sm text-red-600 border border-red-200 bg-red-50 rounded p-2">
                    {catalogError}
                  </div>
                )}

                {/* Filtered search results */}
                {query.trim() !== '' && (
                  <div className="border rounded-md bg-white/80 backdrop-blur-sm max-h-56 overflow-auto">
                    {filtered.length === 0 ? (
                      <div className="p-3 text-sm text-muted-foreground">No matching subjects</div>
                    ) : (
                      filtered.map((c) => (
                        <button
                          key={c.code}
                          type="button"
                          className="w-full text-left px-3 py-2 hover:bg-muted/50"
                          onClick={() => addSubject(c)}
                          disabled={subjectsLocked}
                        >
                          <div className="font-medium">{c.code}</div>
                          <div className="text-xs text-muted-foreground">{c.name}</div>
                        </button>
                      ))
                    )}
                  </div>
                )}

                {/* Chosen subjects */}
                {chosen.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-sm">Selected</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {chosen.map((s) => (
                        <div key={s.code} className="rounded-lg border p-3 bg-white/80">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-semibold">{s.code}</div>
                              <div className="text-xs text-muted-foreground">{s.name}</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeSubject(s.code)}
                              className="p-1 hover:opacity-80"
                              disabled={subjectsLocked}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="mt-2">
                            <Label className="text-xs">Total (default {s.total})</Label>
                            <Input
                              type="number"
                              min={0}
                              value={s.total}
                              onChange={(e) => updateTotal(s.code, e.target.value)}
                              disabled={subjectsLocked}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    {subjectsLocked && (
                      <div className="text-sm text-muted-foreground mt-2">
                        Subject selection is locked until email verification is complete.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Submit button */}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (isLogin ? 'Signing in…' : 'Creating account…') : isLogin ? 'Sign In' : 'Create Account'}
            </Button>
          </form>

          {/* Switch Login/Signup */}
          <div className="text-center">
            <Button variant="link" onClick={() => setIsLogin(!isLogin)} className="text-sm">
              {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;
