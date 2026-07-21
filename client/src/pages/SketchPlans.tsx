import React, { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { SupplierLayout } from "@/components/layout/SupplierLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Edit2, FileText, Calendar, MapPin, Layers, Lock, AlertCircle, Check, X, GitBranch, ChevronDown, Copy } from "lucide-react";
import apiFetch from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth-context";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DeleteConfirmationDialog } from "@/components/ui/DeleteConfirmationDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Group plans by their root (parent_plan_id or id)
interface PlanGroup {
  rootId: string;
  projectName: string;
  projectId: string | null;
  name: string;
  versions: any[];
}

function groupPlansByRoot(plans: any[]): PlanGroup[] {
  const groups: Record<string, PlanGroup> = {};

  for (const plan of plans) {
    const rootId = plan.parent_plan_id || plan.id;
    if (!groups[rootId]) {
      groups[rootId] = {
        rootId,
        projectName: plan.project_name || "No Project",
        projectId: plan.project_id || null,
        name: plan.name,
        versions: [],
      };
    }
    groups[rootId].versions.push(plan);
  }

  // Sort versions within each group
  for (const g of Object.values(groups)) {
    g.versions.sort((a, b) => (b.version_number || 1) - (a.version_number || 1));
    // Use the name from the latest version
    g.name = g.versions[0]?.name || g.name;
    g.projectName = g.versions[0]?.project_name || g.projectName;
  }

  return Object.values(groups).sort((a, b) => {
    // Sort by most recent version's created_at DESC
    const aDate = new Date(a.versions[0]?.created_at || 0).getTime();
    const bDate = new Date(b.versions[0]?.created_at || 0).getTime();
    return bDate - aDate;
  });
}

const VERSION_STATUS_COLOR: Record<string, string> = {
  draft: "bg-yellow-100 text-yellow-700 border-yellow-200",
  submitted: "bg-blue-100 text-blue-700 border-blue-200",
  approved: "bg-green-100 text-green-700 border-green-200",
  locked: "bg-slate-100 text-slate-600 border-slate-200",
};

export default function SketchPlans() {
  const [plans, setPlans] = useState<any[]>([]);
  const [planSearch, setPlanSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showRequestsDialog, setShowRequestsDialog] = useState(false);
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const isSupplier = user?.role === 'supplier';
  const [shopInfo, setShopInfo] = useState({ name: "", location: "" });
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; id: string; name: string } | null>(null);
  // Per-group selected version id
  const [selectedVersions, setSelectedVersions] = useState<Record<string, string>>({});
  const [creatingVersion, setCreatingVersion] = useState<string | null>(null);
  const [showTasksMode, setShowTasksMode] = useState(false);
  const [assignedTasks, setAssignedTasks] = useState<any[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [projects, setProjects] = useState<any[]>([]);
  const [cloneDialog, setCloneDialog] = useState<{ isOpen: boolean; sourceId: string; name: string; projectId: string; versions: any[] } | null>(null);
  const [isCloning, setIsCloning] = useState(false);

  useEffect(() => {
    if (isSupplier) {
      const loadShop = async () => {
        try {
          const r = await apiFetch("/api/supplier/my-shops");
          if (r.ok) {
            const { shops } = await r.json();
            if (shops?.length > 0) {
              setShopInfo({ name: shops[0].name, location: shops[0].location || "" });
            }
          }
        } catch (e) { console.error("shop load error", e); }
      };
      loadShop();
    }
  }, [isSupplier]);

  const loadPlans = async () => {
    try {
      setLoading(true);
      const res = await apiFetch("/api/sketch-plans");
      if (res.ok) {
        const data = await res.json();
        setPlans(data.plans || []);
      }
    } catch (err) {
      console.error("Failed to load sketch plans", err);
      toast({ title: "Error", description: "Failed to load sketch plans", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const loadAssignedTasks = async () => {
    try {
      setLoadingTasks(true);
      const res = await apiFetch("/api/sketch-plans/assigned-tasks");
      if (res.ok) {
        const data = await res.json();
        setAssignedTasks(data.tasks || []);
      }
    } catch (err) {
      console.error("Failed to load tasks", err);
    } finally {
      setLoadingTasks(false);
    }
  };

  const loadProjects = async () => {
    try {
      const res = await apiFetch("/api/boq-projects");
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects || []);
      }
    } catch (err) {
      console.error("Failed to load projects", err);
    }
  };

  const updateTaskStatus = async (taskId: string, status: string) => {
    try {
      const res = await apiFetch(`/api/sketch-plans/assigned-tasks/${taskId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        toast({ title: "Success", description: `Task marked as ${status}` });
        loadAssignedTasks();
      }
    } catch (err) {
      toast({ title: "Error", description: "Failed to update task", variant: "destructive" });
    }
  };

  useEffect(() => {
    loadPlans();
    loadAssignedTasks();
    loadProjects();
  }, []);

  // Init selected version to latest per group
  useEffect(() => {
    const groups = groupPlansByRoot(plans);
    const init: Record<string, string> = {};
    for (const g of groups) {
      if (!selectedVersions[g.rootId] || !g.versions.find(v => v.id === selectedVersions[g.rootId])) {
        init[g.rootId] = g.versions[0]?.id || "";
      }
    }
    if (Object.keys(init).length > 0) {
      setSelectedVersions(prev => ({ ...init, ...prev }));
    }
  }, [plans]);

  const deletePlan = (id: string) => {
    const plan = plans.find(p => p.id === id);
    if (!plan) return;
    setDeleteConfirm({
      isOpen: true,
      id: id,
      name: plan.name || "Sketch Plan"
    });
  };

  const confirmDelete = async (action: 'archive' | 'trash') => {
    if (!deleteConfirm) return;
    try {
      const res = await apiFetch(`/api/sketch-plans/${deleteConfirm.id}?action=${action}`, { method: "DELETE" });
      if (res.ok) {
        toast({ title: action === 'trash' ? "Plan moved to trash" : "Plan archived" });
        loadPlans();
      }
    } catch (err) {
      toast({ title: "Error", description: "Failed to delete plan", variant: "destructive" });
    } finally {
      setDeleteConfirm(null);
    }
  };

  const handleCreateNewVersion = async (group: PlanGroup) => {
    const currentVersionId = selectedVersions[group.rootId] || group.versions[0]?.id;
    if (!currentVersionId) return;
    setCreatingVersion(group.rootId);
    try {
      const res = await apiFetch(`/api/sketch-plans/${currentVersionId}/new-version`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        toast({ title: "Version Created", description: `Version ${data.version_number} created from current plan` });
        await loadPlans();
        // Auto-select the new version
        setSelectedVersions(prev => ({ ...prev, [group.rootId]: data.id }));
      } else {
        toast({ title: "Error", description: "Failed to create new version", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Error", description: "Failed to create new version", variant: "destructive" });
    } finally {
      setCreatingVersion(null);
    }
  };

  const handleClonePlan = async () => {
    if (!cloneDialog || !cloneDialog.sourceId) return;
    setIsCloning(true);
    try {
      const res = await apiFetch(`/api/sketch-plans/${cloneDialog.sourceId}/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: cloneDialog.name,
          projectId: cloneDialog.projectId === "none" ? null : cloneDialog.projectId
        })
      });

      if (res.ok) {
        const data = await res.json();
        toast({ title: "Plan Cloned", description: `"${cloneDialog.name}" has been created as a new plan.` });
        setCloneDialog(null);
        await loadPlans();
        // Redirect to edit the new plan
        setLocation(`/edit-sketch-plan/${data.id}`);
      } else {
        const data = await res.json();
        toast({
          title: "Error",
          description: data.details ? `Failed: ${data.details}` : (data.message || "Failed to clone plan"),
          variant: "destructive"
        });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to clone plan", variant: "destructive" });
    } finally {
      setIsCloning(false);
    }
  };

  const handleEditRequest = async (planId: string, action: 'approve' | 'reject') => {
    try {
      const res = await apiFetch(`/api/sketch-plans/${planId}/handle-unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      if (res.ok) {
        toast({ title: "Success", description: `Edit request ${action}d successfully` });
        loadPlans();
        if (pendingRequests.length <= 1) setShowRequestsDialog(false);
      } else {
        toast({ title: "Error", description: `Failed to ${action} request`, variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Error", description: "Error handling request", variant: "destructive" });
    }
  };

  const pendingRequests = plans.filter(p => p.is_locked && p.request_status === 'pending');
  const isAdmin = user?.role === 'admin';

  const filteredGroups = groupPlansByRoot(plans).filter(g => {
    const search = planSearch.trim().toLowerCase();
    if (!search) return true;
    return [g.name, g.projectName, g.rootId, ...g.versions.map(v => v.location)].some(
      val => String(val || "").toLowerCase().includes(search)
    );
  });

  const LayoutComponent = isSupplier ? SupplierLayout : Layout;

  return (
    <LayoutComponent
      {...(isSupplier ? { shopName: shopInfo.name, shopLocation: shopInfo.location, shopApproved: true } : {})}
    >
      <div className="space-y-6">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-3xl">📐</span>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Sketch a Plan</h1>
                <p className="text-muted-foreground">Capture and manage site requirements and sketches</p>
              </div>
            </div>
            <div className="flex gap-2">
              {isAdmin && pendingRequests.length > 0 && (
                <Button variant="outline" className="relative flex items-center gap-2 border-amber-500 text-amber-600 hover:bg-amber-50" onClick={() => setShowRequestsDialog(true)}>
                  <AlertCircle className="w-4 h-4" /> Edit Requests
                  <Badge variant="secondary" className="bg-amber-100 text-amber-700 ml-1">{pendingRequests.length}</Badge>
                </Button>
              )}
              {!isSupplier && (
                <>
                  <Button
                    variant={showTasksMode ? "default" : "outline"}
                    onClick={() => setShowTasksMode(!showTasksMode)}
                    className={`flex items-center gap-2 ${showTasksMode ? 'bg-indigo-600 text-white' : ''}`}
                  >
                    <Check className="w-4 h-4" /> Assigned Tasks
                    {assignedTasks.filter(t => t.user_task_status !== 'completed').length > 0 && (
                      <Badge className="ml-1 bg-red-500">{assignedTasks.filter(t => t.user_task_status !== 'completed').length}</Badge>
                    )}
                  </Button>
                  <Button variant="outline" onClick={() => setLocation("/sketch-templates")} className="flex items-center gap-2">
                    <Layers className="w-4 h-4" /> Manage Templates
                  </Button>
                </>
              )}
              <Button onClick={() => setLocation("/create-sketch-plan")} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white">
                <Plus className="w-4 h-4" /> Create New Plan
              </Button>
            </div>
          </div>
        </div>

        <div className="sticky top-0 z-20 bg-white shadow-sm border-b border-slate-200 p-4 rounded-lg mb-4">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={planSearch}
              onChange={(e) => setPlanSearch(e.target.value)}
              placeholder="Search plans by name, location, project, or ID..."
              className="w-full md:w-80 h-10 px-3 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
        </div>

        <div className="space-y-4">
          {loading || loadingTasks ? (
            <div className="py-20 text-center text-muted-foreground italic">Loading...</div>
          ) : showTasksMode ? (
            <div className="space-y-4">
              {assignedTasks.length === 0 ? (
                <div className="py-20 border border-dashed rounded-xl text-center text-muted-foreground">No tasks assigned to you.</div>
              ) : (
                assignedTasks.map((task) => (
                  <Card key={task.id} className={`border rounded-xl shadow-sm overflow-hidden ${task.user_task_status === 'completed' ? 'opacity-70 bg-slate-50' : 'bg-white'}`}>
                    <CardHeader className="py-3 px-4 bg-slate-50/50 border-b flex flex-row items-center justify-between">
                      <div>
                        <CardTitle className="text-sm font-bold flex items-center gap-2">
                          {task.user_task_status === 'completed' ? <Check className="w-4 h-4 text-green-500" /> : <Layers className="w-4 h-4 text-indigo-500" />}
                          {task.item_name}
                        </CardTitle>
                        <p className="text-[11px] text-slate-500 font-medium">Plan: <span className="text-indigo-600">{task.plan_name}</span></p>
                      </div>
                      <div className="flex items-center gap-2">
                        {task.user_task_status !== 'completed' ? (
                          <Button
                            size="sm"
                            className="h-7 text-[10px] bg-green-600 hover:bg-green-700 text-white font-bold"
                            onClick={() => updateTaskStatus(task.id, 'completed')}
                          >
                            Mark as Complete
                          </Button>
                        ) : (
                          <Badge className="bg-green-100 text-green-700 border-green-200">Completed</Badge>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[10px]"
                          onClick={() => setLocation(`/edit-sketch-plan/${task.plan_id}`)}
                        >
                          View Plan
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="p-4">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <p className="text-[10px] uppercase font-bold text-slate-400">Dimensions</p>
                          <p className="text-xs font-medium">
                            {task.length || 0} x {task.width || 0} x {task.height || 0} {task.unit}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase font-bold text-slate-400">Quantity</p>
                          <p className="text-xs font-bold text-indigo-600">{task.qty} {task.unit}</p>
                        </div>
                        {task.description && (
                          <div className="col-span-2">
                            <p className="text-[10px] uppercase font-bold text-slate-400">Notes/Instructions</p>
                            <p className="text-xs italic text-slate-600">"{task.description}"</p>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="py-20 border border-dashed rounded-xl text-center text-muted-foreground">No matching plans found.</div>
          ) : (
            filteredGroups.map((group) => {
              const selectedId = selectedVersions[group.rootId] || group.versions[0]?.id;
              const selectedPlan = group.versions.find(v => v.id === selectedId) || group.versions[0];
              if (!selectedPlan) return null;

              const versionStatusColor = VERSION_STATUS_COLOR[selectedPlan.version_status || 'draft'] || VERSION_STATUS_COLOR.draft;

              return (
                <div key={group.rootId} className="border rounded-xl shadow-sm bg-white overflow-hidden">
                  {/* Header row with plan name & project */}
                  <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b">
                    <div className="min-w-0">
                      <p className="text-base font-bold text-slate-900 truncate">{group.name}</p>
                      <p className="text-[11px] text-indigo-600 font-semibold mt-0.5">{group.projectName}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Version Selector */}
                      {group.versions.length > 1 ? (
                        <Select
                          value={selectedId}
                          onValueChange={val => setSelectedVersions(prev => ({ ...prev, [group.rootId]: val }))}
                        >
                          <SelectTrigger className="h-8 w-28 text-xs border-indigo-200 bg-indigo-50 text-indigo-700 font-semibold">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {group.versions.map(v => (
                              <SelectItem key={v.id} value={v.id} className="text-xs">
                                V{v.version_number || 1} — {v.version_status === 'approved' ? '✅' : v.is_locked ? '🔒' : '📝'}
                                {v.version_status === 'approved' ? ' Approved' : v.is_locked ? ' Locked' : ' Draft'}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-[11px] px-2 py-1 rounded-full bg-indigo-50 text-indigo-600 font-bold border border-indigo-100">
                          V{selectedPlan?.version_number || 1}
                        </span>
                      )}

                      {/* Status Badge */}
                      <span className={`text-[10px] px-2 py-0.5 rounded border font-semibold ${versionStatusColor}`}>
                        {selectedPlan.is_locked ? 'Locked' : (selectedPlan.version_status || 'Draft')}
                      </span>
                    </div>
                  </div>

                  {/* Body row with details and actions */}
                  <div className="flex items-center justify-between px-4 py-3 gap-3">
                    <div className="flex flex-wrap gap-2 text-[11px] text-slate-600">
                      {selectedPlan.location && (
                        <span className="flex items-center gap-1 px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded border border-blue-100">
                          <MapPin className="w-2.5 h-2.5" /> {selectedPlan.location}
                        </span>
                      )}
                      {selectedPlan.plan_date && (
                        <span className="flex items-center gap-1 px-1.5 py-0.5 bg-cyan-50 text-cyan-700 rounded border border-cyan-100">
                          <Calendar className="w-2.5 h-2.5" />
                          {format(new Date(selectedPlan.plan_date), 'dd/MM/yyyy')}
                        </span>
                      )}
                      <span className="px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded text-[10px]">
                        ID: {selectedPlan.id.split('-')[1]}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* New Version Button — admin only */}
                      {!isSupplier && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px] gap-1 text-violet-600 border-violet-200 hover:bg-violet-50"
                          onClick={() => handleCreateNewVersion(group)}
                          disabled={creatingVersion === group.rootId}
                          title="Create a new version of this plan (copies all items)"
                        >
                          <GitBranch className="w-3 h-3" />
                          {creatingVersion === group.rootId ? 'Creating...' : 'New Version'}
                        </Button>
                      )}

                      {!isSupplier && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px] gap-1 text-amber-600 border-amber-200 hover:bg-amber-50"
                          onClick={() => setCloneDialog({
                            isOpen: true,
                            sourceId: selectedPlan.id,
                            name: `${selectedPlan.name} (Clone)`,
                            projectId: selectedPlan.project_id || "none",
                            versions: group.versions
                          })}
                          title="Clone this plan as a new root plan"
                        >
                          <Copy className="w-3 h-3" />
                          Clone
                        </Button>
                      )}

                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() => setLocation(`/edit-sketch-plan/${selectedPlan.id}${isSupplier ? '?readOnly=true' : ''}`)}
                      >
                        {isSupplier ? 'View' : 'Open'}
                      </Button>

                      {!isSupplier && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-[11px] text-red-500 hover:text-red-600"
                          onClick={() => deletePlan(selectedPlan.id)}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Version tabs strip if >1 versions */}
                  {group.versions.length > 1 && (
                    <div className="flex items-center gap-1 px-4 pb-2 border-t bg-slate-50/50 pt-2 overflow-x-auto">
                      <span className="text-[10px] text-slate-400 font-bold uppercase mr-1 shrink-0">Versions:</span>
                      {[...group.versions].reverse().map(v => (
                        <button
                          key={v.id}
                          onClick={() => setSelectedVersions(prev => ({ ...prev, [group.rootId]: v.id }))}
                          className={`text-[10px] px-2 py-0.5 rounded-full font-bold border transition-all whitespace-nowrap ${v.id === selectedId
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white text-slate-500 border-slate-200 hover:bg-indigo-50 hover:text-indigo-600'
                            }`}
                        >
                          V{v.version_number || 1}
                          {v.is_locked ? ' 🔒' : v.version_status === 'approved' ? ' ✅' : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <Dialog open={showRequestsDialog} onOpenChange={setShowRequestsDialog}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Pending Edit Requests</DialogTitle>
            <DialogDescription>Review and approve edit requests for locked sketch plans.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
            {pendingRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No pending requests at this time.</p>
            ) : (
              pendingRequests.map(req => (
                <Card key={req.id} className="border-amber-200 bg-amber-50/50">
                  <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2 tracking-tight">
                        <Lock className="w-4 h-4 text-amber-500" />
                        {req.name}
                      </CardTitle>
                      {req.project_name && <p className="text-xs text-muted-foreground mt-0.5 font-medium">Project: {req.project_name}</p>}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="border-red-200 text-red-600 hover:bg-red-50 h-8" onClick={() => handleEditRequest(req.id, 'reject')}>
                        <X className="w-4 h-4 mr-1" /> Reject
                      </Button>
                      <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white h-8" onClick={() => handleEditRequest(req.id, 'approve')}>
                        <Check className="w-4 h-4 mr-1" /> Approve
                      </Button>
                    </div>
                  </CardHeader>
                </Card>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {deleteConfirm && (
        <DeleteConfirmationDialog
          isOpen={!!deleteConfirm}
          onOpenChange={(open) => !open && setDeleteConfirm(null)}
          onConfirm={confirmDelete}
          itemName={deleteConfirm.name}
          title="Delete Sketch Plan?"
        />
      )}

      {/* Clone Plan Dialog */}
      <Dialog open={!!cloneDialog?.isOpen} onOpenChange={(open) => !open && setCloneDialog(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Copy className="w-5 h-5 text-amber-500" />
              Clone Sketch Plan
            </DialogTitle>
            <DialogDescription>
              Create a new standalone copy of this plan. You can change the name and project.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="clone-name">Plan Name</Label>
              <Input
                id="clone-name"
                value={cloneDialog?.name || ""}
                onChange={(e) => setCloneDialog(prev => prev ? { ...prev, name: e.target.value } : null)}
                placeholder="Enter new plan name..."
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="clone-version">Source Version</Label>
              <Select
                value={cloneDialog?.sourceId || ""}
                onValueChange={(val) => setCloneDialog(prev => prev ? { ...prev, sourceId: val } : null)}
              >
                <SelectTrigger id="clone-version">
                  <SelectValue placeholder="Select version to clone" />
                </SelectTrigger>
                <SelectContent className="max-h-[200px] overflow-y-auto">
                  {cloneDialog?.versions?.map((v: any) => (
                    <SelectItem key={v.id} value={v.id}>
                      Version {v.version_number} ({v.version_status || 'Draft'})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="clone-project">Target Project</Label>
              <Select
                value={cloneDialog?.projectId || "none"}
                onValueChange={(val) => setCloneDialog(prev => prev ? { ...prev, projectId: val } : null)}
              >
                <SelectTrigger id="clone-project">
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent className="max-h-[300px] overflow-y-auto">
                  <SelectItem value="none">No Project</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloneDialog(null)} disabled={isCloning}>Cancel</Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={handleClonePlan}
              disabled={isCloning || !cloneDialog?.name}
            >
              {isCloning ? "Cloning..." : "Confirm Clone"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </LayoutComponent>
  );
}
