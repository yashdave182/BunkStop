// src/pages/Profile.tsx
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import { ArrowLeft, Calendar, Trash2, User } from 'lucide-react';

type AttendanceRecord = { id: string; subject: string; date: string; note: string | null };
type TotalsRow = { subject: string; count: number; total: number };
type CatalogItem = { code: string; name: string; default_total: number };

const Profile = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [name, setName] = useState<string>('Student');
  const [email, setEmail] = useState<string>('');

  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<AttendanceRecord | null>(null);

  const [totalsRows, setTotalsRows] = useState<TotalsRow[]>([]);
  const rowsBySubject = useMemo(() => {
    const m: Record<string, TotalsRow> = {};
    totalsRows.forEach(r => (m[r.subject] = r));
    return m;
  }, [totalsRows]);

  // edit total dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<string | null>(null);
  const [editingTotalValue, setEditingTotalValue] = useState<number | string>('');
  const [editSaving, setEditSaving] = useState(false);

  // add subject
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [addSubject, setAddSubject] = useState<string>('');
  const [addTotal, setAddTotal] = useState<string>('');
  const [adding, setAdding] = useState(false);

  const fetchEverything = async () => {
    if (!user) return;
    setLoading(true);
    try {
      // profile
      const { data: prof } = await supabase
        .from('profiles')
        .select('name, user_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (prof) setName(prof.name || 'Student');
      setEmail(user.email || '');

      // subjects catalog
      const { data: cat } = await supabase
        .from('subjects_catalog')
        .select('code, name, default_total')
        .eq('is_active', true)
        .order('code', { ascending: true });
      setCatalog(cat || []);

      // totals
      const { data: totals, error: totalsErr } = await supabase
        .from('attendance_totals')
        .select('subject, count, total')
        .eq('student_id', user.id)
        .order('subject', { ascending: true });
      if (totalsErr) throw totalsErr;
      setTotalsRows((totals ?? []).map(r => ({ subject: r.subject, count: r.count ?? 0, total: r.total ?? 0 })));

      // logs
      const { data: logs, error: logsErr } = await supabase
        .from('attendance')
        .select('id, subject, date, note')
        .eq('student_id', user.id)
        .order('date', { ascending: false });
      if (logsErr) throw logsErr;
      setAttendanceRecords(logs ?? []);
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message || 'Failed to load profile', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    fetchEverything();

    const chTotals = supabase
      .channel('rt-profile-totals')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_totals', filter: `student_id=eq.${user.id}` }, fetchEverything)
      .subscribe();

    const chLogs = supabase
      .channel('rt-profile-logs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance', filter: `student_id=eq.${user.id}` }, fetchEverything)
      .subscribe();

    return () => {
      try { supabase.removeChannel(chTotals); } catch {}
      try { supabase.removeChannel(chLogs); } catch {}
    };
  }, [user]);

  const formatDate = (dateString: string) => {
    const d = new Date(dateString);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  // subject edit total
  const openEditTotal = (subject: string) => {
    const r = rowsBySubject[subject];
    if (!r) return;
    setEditingSubject(subject);
    setEditingTotalValue(r.total);
    setEditOpen(true);
  };

  const saveEditTotal = async () => {
    if (!user || !editingSubject) return;
    const parsed = Number(editingTotalValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast({ title: 'Invalid', description: 'Enter a number ≥ 0', variant: 'destructive' });
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
      setEditOpen(false);
      setEditingSubject(null);
      setEditingTotalValue('');
      await fetchEverything();
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message || 'Failed to update total', variant: 'destructive' });
    } finally {
      setEditSaving(false);
    }
  };

  // add subject
  const handleAddSubject = async () => {
    if (!user) return;
    if (!addSubject) {
      toast({ title: 'Pick a subject', description: 'Select a subject to add.', variant: 'destructive' });
      return;
    }
    const totalNum = Number(addTotal);
    if (!Number.isFinite(totalNum) || totalNum < 0) {
      toast({ title: 'Invalid total', description: 'Enter a non-negative number.', variant: 'destructive' });
      return;
    }
    setAdding(true);
    try {
      const { error } = await supabase.from('attendance_totals').upsert({
        student_id: user.id,
        subject: addSubject,
        total: Math.floor(totalNum),
      });
      if (error) throw error;

      // optional: maintain selected_subjects
      const nextSubjects = Array.from(new Set([...totalsRows.map(r => r.subject), addSubject]));
      await supabase.from('profiles').upsert({
        user_id: user.id,
        name: name || 'Student',
        selected_subjects: nextSubjects,
      });

      setAddSubject('');
      setAddTotal('');
      toast({ title: 'Added', description: `${addSubject} added.` });
      await fetchEverything();
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message || 'Failed to add subject', variant: 'destructive' });
    } finally {
      setAdding(false);
    }
  };

  // delete log + decrement
  const requestDeleteRecord = (rec: AttendanceRecord) => {
    setSelectedRecord(rec);
    setDeleteDialogOpen(true);
  };

  const handleDeleteAttendance = async () => {
    if (!user || !selectedRecord) return;
    try {
      const { error } = await supabase.rpc('delete_log_and_decrement', { p_id: selectedRecord.id });
      if (error) throw error;
      toast({ title: 'Deleted', description: 'Attendance record removed and count updated.' });
      setSelectedRecord(null);
      setDeleteDialogOpen(false);
      await fetchEverything();
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message || 'Failed to delete attendance', variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      {/* Nav */}
      <nav className="bg-white/80 backdrop-blur-sm border-b border-border/50 sticky top-0 z-40">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row justify-between items-center">
          <Button variant="ghost" onClick={() => navigate('/dashboard')} className="flex items-center space-x-2">
            <ArrowLeft className="h-4 w-4" />
            <span>Back to Dashboard</span>
          </Button>
          <div className="flex items-center space-x-2">
            <User className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold text-foreground">Profile</h1>
          </div>
        </div>
      </nav>

      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-6xl">
        {/* Student Info */}
        <Card className="mb-8 bg-white/80 backdrop-blur-sm border-0">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <User className="h-6 w-6" />
              <span>Student Information</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Name</p>
                <p className="text-lg font-semibold">{name || 'Student'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Email</p>
                <p className="text-lg font-semibold">{email}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* My Subjects */}
        <Card className="mb-8 bg-white/80 backdrop-blur-sm border-0">
          <CardHeader>
            <CardTitle>My Subjects</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {totalsRows.length === 0 ? (
              <div className="text-sm text-muted-foreground">No subjects yet — add one below.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {totalsRows.map(({ subject, count, total }) => {
                  const pct = total > 0 ? Math.round(Math.min(count, total) / total * 100) : null;
                  return (
                    <div key={subject} className="p-4 bg-muted/50 rounded-lg flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold">{subject}</div>
                        <Button variant="outline" size="sm" onClick={() => openEditTotal(subject)}>
                          Edit Total
                        </Button>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {total > 0 ? `${Math.min(count, total)} / ${total}` : `${count}`} attended
                      </div>
                      {pct !== null && <div className="text-xs text-muted-foreground">{pct}%</div>}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add subject */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-1">
                <Label className="text-sm">Add Subject</Label>
                <Select value={addSubject} onValueChange={(v) => setAddSubject(v)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Pick a subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {catalog
                      .filter(c => !totalsRows.some(r => r.subject === c.code))
                      .map(c => <SelectItem key={c.code} value={c.code}>{c.code} — {c.name}</SelectItem>)
                    }
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-1">
                <Label className="text-sm">Total Lectures</Label>
                <Input className="mt-1" type="number" min={0} value={addTotal} onChange={(e) => setAddTotal(e.target.value)} placeholder="e.g., 20" />
              </div>
              <div className="md:col-span-1 flex items-end">
                <Button className="w-full" onClick={handleAddSubject} disabled={adding}>
                  {adding ? 'Adding…' : 'Add'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Attendance History */}
        <Card className="bg-white/80 backdrop-blur-sm border-0">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Calendar className="h-6 w-6" />
              <span>Attendance History</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {attendanceRecords.length > 0 ? (
              <>
                {/* Desktop table */}
                <div className="rounded-lg border overflow-x-auto hidden md:block">
                  <Table className="min-w-[700px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Subject</TableHead>
                        <TableHead>Note</TableHead>
                        <TableHead className="w-[100px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {attendanceRecords.map((record) => (
                        <TableRow key={record.id}>
                          <TableCell className="font-medium">{formatDate(record.date)}</TableCell>
                          <TableCell>{record.subject}</TableCell>
                          <TableCell className="max-w-[360px] truncate">{record.note || '-'}</TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => { setSelectedRecord(record); setDeleteDialogOpen(true); }}
                              className="text-destructive hover:text-destructive/90"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile list */}
                <div className="md:hidden space-y-3">
                  {attendanceRecords.map((record) => (
                    <div key={record.id} className="p-4 bg-white/80 backdrop-blur-sm rounded-lg border">
                      <div className="flex items-center justify-between">
                        <div className="text-sm text-muted-foreground">{formatDate(record.date)}</div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setSelectedRecord(record); setDeleteDialogOpen(true); }}
                          className="text-destructive hover:text-destructive/90"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="font-medium">{record.subject}</div>
                      {record.note && <div className="text-xs text-muted-foreground mt-1">{record.note}</div>}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-center py-12">
                <Calendar className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">No attendance records found</p>
                <p className="text-sm text-muted-foreground">Go to the dashboard to start marking your attendance</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Edit Total dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Subject Total</DialogTitle>
            <DialogDescription>Change the total number of lectures for this subject.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <Label className="text-sm">Subject</Label>
            <div className="font-semibold">{editingSubject}</div>
            <Label className="text-sm mt-4">Total Lectures</Label>
            <Input
              type="number"
              min={0}
              value={editingTotalValue}
              onChange={(e: any) => setEditingTotalValue(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={saveEditTotal} disabled={editSaving}>
              {editSaving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete log confirm */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Attendance Record</DialogTitle>
            <DialogDescription>This will remove the log and decrement the subject’s count.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
            <Button className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDeleteAttendance}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Profile;
