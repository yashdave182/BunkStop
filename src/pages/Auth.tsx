// src/pages/Auth.tsx
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { GraduationCap } from 'lucide-react';

// enum union from your generated types ( 'CN' | 'ADA' | 'SE' | 'PE' | 'CS' | 'PDS' | 'CPDP' )
type SubjectCode = Database['public']['Enums']['subject_code'];

const SUBJECTS: SubjectCode[] = ['CN', 'ADA', 'SE', 'PE', 'CS', 'PDS', 'CPDP'];
const PENDING_KEY = 'pending_subject_setup_v1';

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);

  // auth form
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  // onboarding selection (signup only)
  const [checked, setChecked] = useState<Record<SubjectCode, boolean>>(
    () => Object.fromEntries(SUBJECTS.map(s => [s, false])) as Record<SubjectCode, boolean>
  );
  const [totals, setTotals] = useState<Record<SubjectCode, string>>(
    () => Object.fromEntries(SUBJECTS.map(s => [s, ''])) as Record<SubjectCode, string>
  );

  const [loading, setLoading] = useState(false);

  const { signUp, signIn, user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  // ---- helper: create attendance_totals rows (typed RPC, with fallback) ----
  const createTotalsForUser = async (
    userId: string,
    codes: SubjectCode[],
    totalsArr: number[]
  ) => {
    // Try the typed RPC first (forces the correct overload; avoids TS ambiguity)
    const { error: rpcErr } = await supabase.rpc('set_subject_totals', {
  p_subjects: codes,
  p_totals: totalsArr,
});


    if (!rpcErr) return;

    // Fallback: upsert per subject (DB column casts to enum)
    for (let i = 0; i < codes.length; i++) {
      const { error } = await supabase.from('attendance_totals').upsert({
        student_id: userId,
        subject: codes[i],
        total: totalsArr[i] ?? 0,
      });
      if (error) {
        toast({
          title: 'Subjects save failed',
          description: error.message,
          variant: 'destructive',
        });
        throw error;
      }
    }
  };

  // derived list of selected subjects
  const selectedCodes = useMemo(
    () => SUBJECTS.filter(s => checked[s]),
    [checked]
  );

  // Redirect if already authenticated AND no pending onboarding
  useEffect(() => {
    if (!user) return;
    const hasPending = !!localStorage.getItem(PENDING_KEY);
    if (!hasPending) navigate('/dashboard', { replace: true });
  }, [user, navigate]);

  // Commit any pending onboarding after email verification (session available)
  useEffect(() => {
    const run = async () => {
      if (!user) return;
      const raw = localStorage.getItem(PENDING_KEY);
      if (!raw) return;

      try {
        const data = JSON.parse(raw) as {
          name: string;
          codes: SubjectCode[];
          totals: number[];
        };

        // upsert profile
        const { error: profErr } = await supabase.from('profiles').upsert({
          user_id: user.id,
          name: data.name ?? '',
          selected_subjects: data.codes,
          onboarding_complete: true,
        });
        if (profErr) {
          toast({ title: 'Setup failed', description: profErr.message, variant: 'destructive' });
          localStorage.removeItem(PENDING_KEY);
          navigate('/dashboard', { replace: true });
          return;
        }

        // create totals rows
        await createTotalsForUser(user.id, data.codes, data.totals);

        localStorage.removeItem(PENDING_KEY);
        toast({ title: 'Welcome!', description: 'Your subjects have been saved.' });
        navigate('/dashboard', { replace: true });
      } catch (e: any) {
        toast({
          title: 'Setup failed',
          description: e?.message || 'Could not finish onboarding.',
          variant: 'destructive',
        });
        localStorage.removeItem(PENDING_KEY);
        navigate('/dashboard', { replace: true });
      }
    };
    run();
  }, [user, navigate]); // toast is stable enough not to include

  // helpers
  const setCheckedFor = (code: SubjectCode, value: boolean) =>
    setChecked(prev => ({ ...prev, [code]: value }));

  const setTotalFor = (code: SubjectCode, value: string) =>
    setTotals(prev => ({ ...prev, [code]: value }));

  const validateAndBuildPayload = () => {
    if (selectedCodes.length === 0) {
      return { ok: false, msg: 'Select at least one subject from the list.' } as const;
    }
    const t: number[] = [];
    for (const code of selectedCodes) {
      const n = Number(totals[code]);
      if (!Number.isFinite(n) || n < 0) {
        return { ok: false, msg: `Enter a valid non-negative total for ${code}.` } as const;
      }
      t.push(Math.floor(n));
    }
    return { ok: true, codes: selectedCodes, totals: t } as const;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        const { error } = await signIn(email, password);
        if (error) throw error;
        navigate('/dashboard');
        return;
      }

      // Sign Up path
      if (!name.trim()) {
        toast({ title: 'Missing name', description: 'Please enter your full name.', variant: 'destructive' });
        return;
      }
      const v = validateAndBuildPayload();
      if (!v.ok) {
        toast({ title: 'Invalid selection', description: v.msg, variant: 'destructive' });
        return;
      }

      // Create auth user (ensure your useAuth.signUp sends name to user_metadata)
      const { error } = await signUp(email, password, name);
      if (error) throw error;

      // If email confirmations are OFF, you'll have a session right away
      const { data: u } = await supabase.auth.getUser();
      const userId = u.user?.id;

      if (userId) {
        // 1) upsert profile
        const { error: profErr } = await supabase.from('profiles').upsert({
          user_id: userId,
          name: name.trim(),
          selected_subjects: v.codes,
          onboarding_complete: true,
        });
        if (profErr) throw profErr;

        // 2) create totals rows (typed RPC with fallback)
        await createTotalsForUser(userId, v.codes, v.totals);

        toast({ title: 'Account created', description: 'Your subjects have been saved.' });
        navigate('/dashboard');
      } else {
        // Email confirmation ON → defer via localStorage
        localStorage.setItem(PENDING_KEY, JSON.stringify({
          name: name.trim(),
          codes: v.codes,
          totals: v.totals,
        }));
        toast({
          title: 'Verify your email',
          description: 'We sent you a link. After you verify, your subjects will be saved automatically.',
        });
        // stay here; the useEffect will commit after verification
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Something went wrong.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-xl shadow-xl">
        <CardHeader className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="p-3 bg-primary rounded-full">
              <GraduationCap className="h-8 w-8 text-primary-foreground" />
            </div>
          </div>
          <div>
            <CardTitle className="text-2xl font-bold">Student Attendance</CardTitle>
            <CardDescription>
              {isLogin ? 'Sign in to track your attendance' : 'Create your account and set up your subjects'}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your full name"
                  required={!isLogin}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                minLength={6}
              />
            </div>

            {/* Signup-only: fixed subjects selection + totals */}
            {!isLogin && (
              <div className="space-y-3">
                <Label className="text-base">Select Subjects & Totals</Label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {SUBJECTS.map((code) => (
                    <div key={code} className="rounded-lg border p-3 bg-white/80">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={checked[code]}
                          onChange={(e) => setCheckedFor(code, e.target.checked)}
                        />
                        <span className="font-medium">{code}</span>
                      </label>

                      <div className="mt-2">
                        <Label htmlFor={`tot-${code}`} className="text-xs text-muted-foreground">
                          Total for {code}
                        </Label>
                        <Input
                          id={`tot-${code}`}
                          type="number"
                          min={0}
                          placeholder="e.g., 40"
                          value={totals[code]}
                          onChange={(e) => setTotalFor(code, e.target.value)}
                          disabled={!checked[code]}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <div className="flex items-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground"></div>
                  <span>{isLogin ? 'Signing in…' : 'Creating account…'}</span>
                </div>
              ) : isLogin ? (
                'Sign In'
              ) : (
                'Create Account'
              )}
            </Button>
          </form>

          <div className="text-center">
            <Button
              variant="link"
              onClick={() => setIsLogin(!isLogin)}
              className="text-sm"
            >
              {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;
