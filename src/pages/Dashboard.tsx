import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useToast } from '@/hooks/use-toast';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Code,
  Cpu,
  Users,
  Monitor,
  LogOut,
  User,
} from 'lucide-react';

// Enum union from generated types
type SubjectCode = Database['public']['Enums']['subject_code'];

type TotalsRow = {
  subject: SubjectCode; // 'CN' | 'ADA' | ...
  count: number;        // attended so far
  total: number;        // target
};

const SUBJECT_META: Record<
  SubjectCode | string,
  { fullName: string; icon: any; color: string }
> = {
  CN:   { fullName: 'Computer Networks',                  icon: Monitor, color: 'bg-blue-500' },
  ADA:  { fullName: 'Algorithm Design & Analysis',        icon: Code,    color: 'bg-green-500' },
  SE:   { fullName: 'Software Engineering',               icon: BookOpen,color: 'bg-purple-500' },
  PE:   { fullName: 'Professional Ethics',                icon: BookOpen,color: 'bg-orange-500' },
  CPDP: { fullName: 'Career & Personality Development',   icon: Users,   color: 'bg-pink-500' },
  CS:   { fullName: 'Cyber Security (Elective)',          icon: Cpu,     color: 'bg-indigo-500' },
  PDS:  { fullName: 'Python for Data Science (Elective)', icon: Cpu,     color: 'bg-indigo-500' },
};

const Dashboard = () => {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [rows, setRows] = useState<TotalsRow[]>([]);
  const [loading, setLoading] = useState(true);

  // mark modal
  const [selectedSubject, setSelectedSubject] = useState<SubjectCode | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  // edit total modal
  const [editOpen, setEditOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<SubjectCode | null>(null);
  const [editingTotalValue, setEditingTotalValue] = useState<number | string>('');
  const [editSaving, setEditSaving] = useState(false);

  // -------- fetch ONLY from attendance_totals (source of truth) --------
  const fetchTotals = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('attendance_totals')
      .select('subject, count, total')
      .eq('student_id', user.id)
      .order('subject', { ascending: true });

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      setRows([]);
    } else {
      const casted: TotalsRow[] = (data ?? []).map((r: any) => ({
        subject: r.subject as SubjectCode,
        count: r.count ?? 0,
        total: r.total ?? 0,
      }));
      setRows(casted);
    }
    setLoading(false);
  };

  // initial load + lightweight realtime
  useEffect(() => {
    if (!user) return;
    fetchTotals();

    // Realtime refresh whenever totals change for this user
    const ch = supabase
      .channel('rt-totals')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance_totals', filter: `student_id=eq.${user.id}` },
        fetchTotals
      )
      .subscribe();

    return () => {
      try { supabase.removeChannel(ch); } catch {}
    };
  }, [user]);

  // quick lookup map
  const rowsBySubject = useMemo(() => {
    const m: Record<SubjectCode, TotalsRow> = {} as any;
    rows.forEach(r => { m[r.subject] = r; });
    return m;
  }, [rows]);

  // open mark modal, but block if already at max
  const openMarkModal = (subject: SubjectCode) => {
    const r = rowsBySubject[subject];
    if (!r) {
      toast({ title: 'Not configured', description: `Subject ${subject} is not configured.`, variant: 'destructive' });
      return;
    }
    if (r.total > 0 && r.count >= r.total) {
      toast({
        title: 'Max reached',
        description: `${subject} is already ${r.count}/${r.total}.`,
        variant: 'destructive',
      });
      return;
    }
    setSelectedSubject(subject);
    setNote('');
    setIsModalOpen(true);
  };

  // -------------- Mark attendance (NO RPC) --------------
  // Steps: insert log row -> update totals count -> refetch
  const handleConfirmMark = async () => {
    if (!user || !selectedSubject) return;
    setSaving(true);
    try {
      const totalsRow = rowsBySubject[selectedSubject];
      if (!totalsRow) {
        toast({ title: 'Not configured', description: `Subject ${selectedSubject} is not configured.`, variant: 'destructive' });
        return;
      }
      if (totalsRow.total > 0 && totalsRow.count >= totalsRow.total) {
        toast({
          title: 'Max reached',
          description: `${selectedSubject} is already ${totalsRow.count}/${totalsRow.total}.`,
          variant: 'destructive',
        });
        return;
      }

      // 1) Insert log row (date defaults in DB; note is optional)
      {
        const { error } = await supabase.from('attendance').insert({
          student_id: user.id,
          subject: selectedSubject,
          note: note?.trim() || null,
        });
        if (error) throw error;
      }

      // 2) Increment totals count using current value (+1)
      {
        const newCount = (totalsRow.count ?? 0) + 1;
        const { error } = await supabase
          .from('attendance_totals')
          .update({ count: newCount })
          .eq('student_id', user.id)
          .eq('subject', selectedSubject);
        if (error) throw error;
      }

      toast({ title: 'Marked!', description: `Attendance marked for ${selectedSubject}.` });
      await fetchTotals();
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message || 'Failed to mark attendance', variant: 'destructive' });
    } finally {
      setSaving(false);
      setIsModalOpen(false);
      setSelectedSubject(null);
      setNote('');
    }
  };

  const handleLogout = async () => {
    await signOut();
    navigate('/auth');
  };

  // open “Edit Total”
  const openEditTotal = (subject: SubjectCode) => {
    const r = rowsBySubject[subject];
    if (!r) {
      toast({ title: 'Not configured', description: `Subject ${subject} is not configured.`, variant: 'destructive' });
      return;
    }
    setEditingSubject(subject);
    setEditingTotalValue(r.total);
    setEditOpen(true);
  };

  const saveEditTotal = async () => {
    if (!editingSubject || !user) return;
    const parsed = Number(editingTotalValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast({ title: 'Invalid value', description: 'Please enter a number ≥ 0', variant: 'destructive' });
      return;
    }
    setEditSaving(true);
    try {
      const { error } = await supabase
        .from('attendance_totals')
        .update({ total: Math.floor(parsed) })
        .eq('student_id', user.id)
        .eq('subject', editingSubject);
      if (error) throw error;
      toast({ title: 'Saved', description: 'Total updated.' });
      await fetchTotals();
      setEditOpen(false);
      setEditingSubject(null);
      setEditingTotalValue('');
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message || 'Failed to save total', variant: 'destructive' });
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      {/* NAV */}
      <nav className="bg-white/80 backdrop-blur-sm border-b border-border/50 sticky top-0 z-40">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row justify-between items-center">
          <div className="flex items-center space-x-2">
            <BookOpen className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold text-foreground">Attendance Tracker</h1>
          </div>

          <div className="flex items-center space-x-4 mt-3 sm:mt-0">
            <Button variant="outline" onClick={() => navigate('/profile')} className="flex items-center space-x-2">
              <User className="h-4 w-4" />
              <span>Profile</span>
            </Button>
            <Button variant="outline" onClick={handleLogout} className="flex items-center space-x-2">
              <LogOut className="h-4 w-4" />
              <span>Logout</span>
            </Button>
          </div>
        </div>
      </nav>

      {/* BODY */}
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-foreground mb-2">Welcome Back!</h2>
          <p className="text-muted-foreground">Click on a subject to mark your attendance</p>
        </div>

        {/* SUBJECT CARDS — ONLY from attendance_totals */}
        {loading ? (
          <div className="text-center py-12">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            No subjects configured yet. Go to Profile to add your subjects.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {rows.map(({ subject, count, total }) => {
              const meta = SUBJECT_META[subject] ?? {
                fullName: subject,
                icon: BookOpen,
                color: 'bg-gray-400',
              };
              const Icon = meta.icon;
              const capped = total > 0 ? Math.min(count, total) : count;
              const pct = total > 0 ? Math.round((capped / total) * 100) : 0;
              const atMax = total > 0 && count >= total;

              return (
                <Card
                  key={subject}
                  className="group transition-all duration-300 border-0 bg-white/80 backdrop-blur-sm"
                >
                  <CardHeader className="text-center pb-4">
                    <div className={`${meta.color} w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform`}>
                      <Icon className="h-8 w-8 text-white" />
                    </div>
                    <CardTitle className="text-xl font-bold">{subject}</CardTitle>
                  </CardHeader>

                  <CardContent className="text-center">
                    <p className="text-sm text-muted-foreground">{meta.fullName}</p>

                    <div className="mt-3">
                      <div className="text-sm text-muted-foreground">
                        {total > 0 ? `${capped}/${total} attended` : `${capped} attended`}
                      </div>
                      {total > 0 && (
                        <>
                          <div className="w-full h-2 bg-gray-200 rounded mt-2 overflow-hidden">
                            <div className="h-2 bg-primary rounded" style={{ width: `${pct}%` }} />
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">{pct}%</div>
                        </>
                      )}
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <Button
                        className="w-full"
                        size="sm"
                        onClick={() => openMarkModal(subject)}
                        disabled={atMax}
                        title={atMax ? 'Reached total' : 'Mark attendance'}
                      >
                        {atMax ? 'Reached total' : 'Mark'}
                      </Button>

                      <Button
                        variant="outline"
                        className="w-full"
                        size="sm"
                        onClick={() => openEditTotal(subject)}
                      >
                        Edit Total
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* EDIT TOTAL DIALOG */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg w-full">
          <DialogHeader>
            <DialogTitle className="text-lg">Edit Subject Total</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Change the total number of lectures for this subject — percentages update automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="mb-3">
              <label className="text-sm text-muted-foreground block">Subject</label>
              <div className="font-semibold text-foreground">{editingSubject}</div>
            </div>

            <div className="mb-3">
              <label className="text-sm text-muted-foreground block">Total Lectures</label>
              <Input
                type="number"
                min={0}
                value={editingTotalValue}
                onChange={(e: any) =>
                  setEditingTotalValue(e.target.value === '' ? '' : Number(e.target.value))
                }
                className="mt-2"
              />
              <p className="text-xs text-muted-foreground mt-2">
                Set to 0 if there are no scheduled lectures.
              </p>
            </div>
          </div>

          <DialogFooter>
            <div className="flex w-full justify-between items-center">
              <Button
                variant="outline"
                onClick={() => {
                  setEditOpen(false);
                  setEditingSubject(null);
                  setEditingTotalValue('');
                }}
              >
                Cancel
              </Button>
              <div className="flex items-center space-x-2">
                <Button onClick={saveEditTotal} disabled={editSaving}>
                  {editSaving ? (
                    <div className="flex items-center space-x-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground"></div>
                      <span>Saving…</span>
                    </div>
                  ) : (
                    'Save'
                  )}
                </Button>
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MARK MODAL */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Attendance</DialogTitle>
            <DialogDescription>
              You attended the <strong>{selectedSubject}</strong> lecture. Add a note (optional) and confirm.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2 py-2">
            <Label htmlFor="note">Note (optional)</Label>
            <Textarea
              id="note"
              placeholder="e.g., lab only, proxy, left early…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={280}
            />
            <div className="text-xs text-gray-500 text-right">{note.length}/280</div>
          </div>

          <DialogFooter className="space-x-2">
            <Button variant="outline" onClick={() => setIsModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleConfirmMark} disabled={saving || !selectedSubject}>
              {saving ? (
                <div className="flex items-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground"></div>
                  <span>Marking…</span>
                </div>
              ) : (
                'Yes, Mark Attendance'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Dashboard;
