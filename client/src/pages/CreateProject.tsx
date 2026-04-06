import { useEffect, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { cn } from "@/lib/utils";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";

import {
  Building2,
  MapPin,
  User,
  Receipt,
  Calculator,
  Library,
  History,
  Trash2,
  ChevronRight,
  ChevronDown,
  Briefcase,
  Pencil,
  Copy,
  Clock,
  Search
} from "lucide-react";
import apiFetch from "@/lib/api";
import { Badge } from "@/components/ui/badge";

const PROJECT_STATUSES: { value: string; label: string; color: string }[] = [
  { value: 'started', label: 'Started', color: 'bg-slate-100 text-slate-700' },
  { value: 'in_progress', label: 'In Progress', color: 'bg-cyan-100 text-cyan-700' },
  { value: 'bom_stage', label: 'BOM Stage', color: 'bg-blue-100 text-blue-700' },
  { value: 'boq_stage', label: 'BOQ Stage', color: 'bg-indigo-100 text-indigo-700' },
  { value: 'client_approval', label: 'Client Approval', color: 'bg-amber-100 text-amber-700' },
  { value: 'work_in_execution', label: 'Work in Execution', color: 'bg-green-100 text-green-700' },
  { value: 'finance', label: 'Finance', color: 'bg-purple-100 text-purple-700' },
  { value: 'hold', label: 'On Hold', color: 'bg-orange-100 text-orange-700' },
  { value: 'cancelled', label: 'Cancelled', color: 'bg-red-100 text-red-700' },
  { value: 'closed', label: 'Closed', color: 'bg-gray-200 text-gray-600' },
];

const getProjectStatusMeta = (s?: string) => PROJECT_STATUSES.find(x => x.value === s) ?? { label: s || 'Started', color: 'bg-slate-100 text-slate-700' };


export default function CreateProject() {
  const createFormRef = (typeof document !== 'undefined') ? { current: null as HTMLDivElement | null } : { current: null };
  const createFormRefCallback = (el: HTMLDivElement | null) => { createFormRef.current = el; };
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [budget, setBudget] = useState("");
  const [location, setLocation] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [gstNo, setGstNo] = useState("");
  const [projectValue, setProjectValue] = useState("");
  const [templateProjectId, setTemplateProjectId] = useState<string>("none");
  const [selectedVersionId, setSelectedVersionId] = useState<string>("none");
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState<string>("");
  const [editingProjectData, setEditingProjectData] = useState<any | null>(null);

  // Clone dialog state
  const [isCloneOpen, setIsCloneOpen] = useState(false);
  const [cloneSourceProject, setCloneSourceProject] = useState<any | null>(null);
  const [cloneNewName, setCloneNewName] = useState("");
  const [cloneBomVersions, setCloneBomVersions] = useState<any[]>([]);
  const [cloneBoqVersions, setCloneBoqVersions] = useState<any[]>([]);
  const [cloneSelectedBoms, setCloneSelectedBoms] = useState<Set<string>>(new Set());
  const [cloneSelectedBoqs, setCloneSelectedBoqs] = useState<Set<string>>(new Set());
  const [isCloning, setIsCloning] = useState(false);

  const { toast } = useToast();
  const [projects, setProjects] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredProjects = projects.filter(p => {
    const q = searchQuery.toLowerCase();
    return (
      (p.name || "").toLowerCase().includes(q) ||
      (p.client || "").toLowerCase().includes(q) ||
      (p.location || "").toLowerCase().includes(q)
    );
  });


  const handleClone = async (p: any) => {
    setCloneSourceProject(p);
    setCloneNewName(p.name ? `Copy of ${p.name}` : "");
    setCloneSelectedBoms(new Set());
    setCloneSelectedBoqs(new Set());
    setIsCloneOpen(true);
    setCloneBomVersions([]);
    setCloneBoqVersions([]);

    try {
      const [bomRes, boqRes] = await Promise.all([
        apiFetch(`/api/boq-versions/${encodeURIComponent(p.id)}?type=bom`),
        apiFetch(`/api/boq-versions/${encodeURIComponent(p.id)}?type=boq`)
      ]);
      if (bomRes.ok) {
        const bomData = await bomRes.json();
        setCloneBomVersions(bomData.versions || []);
      }
      if (boqRes.ok) {
        const boqData = await boqRes.json();
        setCloneBoqVersions(boqData.versions || []);
      }
    } catch (e) {
      console.warn("Failed to load versions for cloning", e);
    }
  };

  const executeClone = async () => {
    if (!cloneSourceProject || !cloneNewName.trim()) return;
    setIsCloning(true);

    try {
      // 1. Create the new project
      const projRes = await apiFetch("/api/boq-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: cloneNewName.trim(),
          client: cloneSourceProject.client || "",
          budget: cloneSourceProject.budget || "",
          location: cloneSourceProject.location || "",
          client_address: cloneSourceProject.client_address || "",
          gst_no: cloneSourceProject.gst_no || "",
          project_value: cloneSourceProject.project_value || "",
          base_version_id: null,
          project_status: cloneSourceProject.project_status || "started"
        }),
      });

      if (!projRes.ok) throw new Error("Failed to create project");
      const newProject = await projRes.json();

      // 2. Clone selected BOM versions sequentially
      for (const versionId of Array.from(cloneSelectedBoms)) {
        const res = await apiFetch(`/api/boq-versions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: newProject.id,
            type: "bom",
            copy_from_version: versionId
          }),
        });
        if (!res.ok) console.error(`Failed to clone BOM version ${versionId}`);
      }

      // 3. Clone selected BOQ versions sequentially
      for (const versionId of Array.from(cloneSelectedBoqs)) {
        const res = await apiFetch(`/api/boq-versions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: newProject.id,
            type: "boq",
            copy_from_version: versionId
          }),
        });
        if (!res.ok) console.error(`Failed to clone BOQ version ${versionId}`);
      }

      setProjects(prev => [newProject, ...prev]);
      setIsCloneOpen(false);
      toast({ title: "Success", description: "Project cloned successfully with selected versions" });
    } catch (err) {
      console.error("Clone failed", err);
      toast({ title: "Error", description: "Failed to clone project", variant: "destructive" });
    } finally {
      setIsCloning(false);
    }
  };


  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [projectVersions, setProjectVersions] = useState<Record<string, any[]>>(
    {},
  );
  const [versionItems, setVersionItems] = useState<Record<string, any[]>>({});
  const [selectedVersions, setSelectedVersions] = useState<Set<string>>(new Set());

  useEffect(() => {
    const load = async () => {
      try {
        const res = await apiFetch("/api/boq-projects", { headers: {} });
        if (res.ok) {
          const data = await res.json();
          const normalized = (data.projects || []).map((p: any) => ({
            ...p,
            project_status: p.project_status ?? p.status,
          }));
          setProjects(normalized);
        }
      } catch (e) {
        console.warn("Failed to load projects", e);
      }
    };
    load();
  }, []);

  const addProject = async () => {
    if (!name.trim()) {
      toast({
        title: "Error",
        description: "Project name is required",
        variant: "destructive",
      });
      return;
    }

    try {
      const response = await apiFetch("/api/boq-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          client: client.trim(),
          budget: budget.trim(),
          location: location.trim(),
          client_address: clientAddress.trim(),
          gst_no: gstNo.trim(),
          project_value: projectValue.trim(),
          base_version_id: selectedVersionId !== "none" ? selectedVersionId : null,
        }),
      });

      if (response.ok) {
        const newProject = await response.json();
        setName("");
        setClient("");
        setBudget("");
        setLocation("");
        setClientAddress("");
        setGstNo("");
        setProjectValue("");
        setTemplateProjectId("none");
        setSelectedVersionId("none");
        setProjects((p) => [newProject, ...p]);
        toast({ title: "Success", description: "Project created" });
      } else {
        toast({
          title: "Error",
          description: "Failed to create project",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("Failed to create project:", err);
      toast({
        title: "Error",
        description: "Failed to create project",
        variant: "destructive",
      });
    }
  };

  const loadProjectVersions = async (projectId: string) => {
    if (projectVersions[projectId]) return;
    try {
      const res = await apiFetch(
        `/api/boq-versions/${encodeURIComponent(projectId)}`,
        { headers: {} },
      );
      if (res.ok) {
        const data = await res.json();
        setProjectVersions((pv) => ({
          ...pv,
          [projectId]: data.versions || [],
        }));
        return data.versions;
      }
    } catch (e) {
      console.warn("Failed to load versions", e);
    }
  };

  const toggleProject = async (projectId: string) => {
    setExpanded((s) => ({ ...s, [projectId]: !s[projectId] }));

    // if expanding and versions not loaded, fetch versions
    if (!expanded[projectId]) {
      const versions = await loadProjectVersions(projectId);
      if (versions) {
        // preload items for all versions (both draft and submitted)
        versions.forEach(async (v: any) => {
          try {
            const r = await apiFetch(
              `/api/boq-items/version/${encodeURIComponent(v.id)}`,
              { headers: {} },
            );
            if (r.ok) {
              const items = await r.json();
              setVersionItems((vi) => ({
                ...vi,
                [v.id]: items.items || [],
              }));
            }
          } catch (e) {
            console.warn("Failed to load items for version", v.id, e);
          }
        });
      }
    }
  };

  const deleteProject = async (projectId: string) => {
    if (!confirm("Are you sure you want to delete this project? This cannot be undone.")) {
      return;
    }

    try {
      const response = await apiFetch(`/api/boq-projects/${projectId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setProjects((p) => p.filter((proj) => proj.id !== projectId));
        toast({ title: "Success", description: "Project deleted" });
      } else {
        toast({
          title: "Error",
          description: "Failed to delete project",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("Failed to delete project:", err);
      toast({
        title: "Error",
        description: "Failed to delete project",
        variant: "destructive",
      });
    }
  };

  const saveFullProject = async () => {
    if (!editingProjectData || !editingProjectData.name?.trim()) {
      toast({ title: "Error", description: "Project name is required", variant: "destructive" });
      return;
    }
    try {
      const response = await apiFetch(`/api/boq-projects/${editingProjectData.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingProjectData),
      });

      if (response.ok) {
        setProjects((p) =>
          p.map((proj) =>
            proj.id === editingProjectData.id ? { ...proj, ...editingProjectData } : proj
          )
        );
        setEditingProjectData(null);
        toast({ title: "Success", description: "Project updated" });
      } else {
        toast({
          title: "Error",
          description: "Failed to update project",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("Failed to update project:", err);
      toast({
        title: "Error",
        description: "Failed to update project",
        variant: "destructive",
      });
    }
  };

  const saveProjectName = async (projectId: string) => {
    if (!editingProjectName.trim()) return;
    try {
      const response = await apiFetch(`/api/boq-projects/${projectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editingProjectName.trim() }),
      });

      if (response.ok) {
        setProjects((p) =>
          p.map((proj) =>
            proj.id === projectId ? { ...proj, name: editingProjectName.trim() } : proj
          )
        );
        setEditingProjectId(null);
        toast({ title: "Success", description: "Project name updated" });
      } else {
        toast({
          title: "Error",
          description: "Failed to update project",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("Failed to update project:", err);
      toast({
        title: "Error",
        description: "Failed to update project",
        variant: "destructive",
      });
    }
  };

  const renderStep11Table = (items: any[]) => {
    // items is array of boq_items rows; each has table_data.step11_items
    const rows = items.flatMap((it) =>
      (it.table_data?.step11_items || []).map((si: any, idx: number) => ({
        ...si,
        _sourceId: it.id,
        _idx: idx,
      })),
    );
    if (rows.length === 0)
      return (
        <div className="text-sm text-muted-foreground">No Step 11 items</div>
      );

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-100 border-b">
              <th className="border px-2 py-1">S.No</th>
              <th className="border px-2 py-1">Item</th>
              <th className="border px-2 py-1">Description</th>
              <th className="border px-2 py-1">Unit</th>
              <th className="border px-2 py-1">Qty</th>
              <th className="border px-2 py-1">Supply Rate</th>
              <th className="border px-2 py-1">Install Rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any, i: number) => (
              <tr
                key={`${r._sourceId}-${r._idx}`}
                className="border-b hover:bg-blue-50"
              >
                <td className="border px-2 py-1 text-center">{i + 1}</td>
                <td className="border px-2 py-1">
                  {r.title || r.bill_no || "—"}
                </td>
                <td className="border px-2 py-1">{r.description || ""}</td>
                <td className="border px-2 py-1 text-center">
                  {r.unit || "pcs"}
                </td>
                <td className="border px-2 py-1 text-right">{r.qty ?? "0"}</td>
                <td className="border px-2 py-1 text-right">
                  {r.supply_rate ?? "0"}
                </td>
                <td className="border px-2 py-1 text-right">
                  {r.install_rate ?? "0"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <Layout>
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Create Project</h1>

        <Card ref={createFormRefCallback} className="border-slate-200 shadow-sm overflow-hidden bg-white">
          <div className="border-b border-slate-100 px-6 py-4 flex items-center gap-3">
            <Library className="w-5 h-5 text-slate-500" />
            <div>
              <h2 className="text-lg font-bold text-slate-800">Create New Project</h2>
              <p className="text-slate-500 text-[11px]">Fill in the project details below. All fields will be saved to the database.</p>
            </div>
          </div>
          <CardContent className="space-y-6 pt-6 bg-slate-50/50">

            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-5">
              <div className="space-y-1.5 group">
                <Label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">
                  <Briefcase className="w-3 h-3 text-indigo-400" /> Project Name
                </Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter project name..."
                  className="border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all rounded-lg"
                />
              </div>
              <div className="space-y-1.5 group">
                <Label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">
                  <User className="w-3 h-3 text-indigo-400" /> Client Name
                </Label>
                <Input
                  value={client}
                  onChange={(e) => setClient(e.target.value)}
                  placeholder="Full name of the client"
                  className="border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all rounded-lg"
                />
              </div>
              <div className="space-y-1.5 group">
                <Label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">
                  <Receipt className="w-3 h-3 text-indigo-400" /> GST No.
                </Label>
                <Input
                  value={gstNo}
                  onChange={(e) => setGstNo(e.target.value)}
                  placeholder="GSTIN (Optional)"
                  className="border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all rounded-lg"
                />
              </div>

              <div className="space-y-1.5 group">
                <Label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">
                  <MapPin className="w-3 h-3 text-indigo-400" /> Project Location
                </Label>
                <Input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="City / Site Area"
                  className="border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all rounded-lg"
                />
              </div>
              <div className="space-y-1.5 group md:col-span-2">
                <Label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">
                  <Building2 className="w-3 h-3 text-indigo-400" /> Client Billing Address
                </Label>
                <Input
                  value={clientAddress}
                  onChange={(e) => setClientAddress(e.target.value)}
                  placeholder="Detailed address for reports and invoices"
                  className="border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all rounded-lg"
                />
              </div>

              <div className="space-y-1.5 group">
                <Label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">
                  <Calculator className="w-3 h-3 text-indigo-400" /> Target Budget
                </Label>
                <Input
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="Allocated budget..."
                  className="border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all rounded-lg"
                />
              </div>
              <div className="space-y-1.5 group">
                <Label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">
                  <Receipt className="w-3 h-3 text-indigo-400" /> Project Value
                </Label>
                <Input
                  value={projectValue}
                  onChange={(e) => setProjectValue(e.target.value)}
                  placeholder="Final contract value..."
                  className="border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all rounded-lg"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">
                  <History className="w-3 h-3 text-indigo-400" /> Version Template
                </Label>
                <div className="flex gap-2">
                  <Select
                    value={templateProjectId}
                    onValueChange={(val) => {
                      setTemplateProjectId(val);
                      setSelectedVersionId("none");
                      if (val !== "none") loadProjectVersions(val);
                    }}
                  >
                    <SelectTrigger className="border-slate-200 rounded-lg flex-1 text-xs">
                      <SelectValue placeholder="Use existing project..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">New empty project</SelectItem>
                      {projects.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {templateProjectId !== "none" && (
                    <Select value={selectedVersionId} onValueChange={setSelectedVersionId}>
                      <SelectTrigger className="border-slate-200 rounded-lg w-24 bg-blue-50/50 text-xs">
                        <SelectValue placeholder="Ver" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— None —</SelectItem>
                        {(projectVersions[templateProjectId] || []).map((v: any) => (
                          <SelectItem key={v.id} value={v.id}>V{v.version_number}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <p className="text-[9px] text-slate-400 mt-0.5 italic">Leave empty for a fresh new project</p>
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-100">
              <Button onClick={addProject} className="bg-slate-800 hover:bg-slate-900 text-white font-medium px-8 py-2 rounded-md shadow-sm transition-all flex items-center gap-2 text-sm">
                <Library className="w-4 h-4" /> Create Project
              </Button>
            </div>
          </CardContent>
        </Card>
        {/* Projects list */}
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-4">
              <h2 className="text-lg font-semibold">Existing Projects</h2>
              <div className="relative w-full md:w-64 group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                <Input
                  className="pl-9 h-9 text-xs border-slate-200 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100 rounded-lg shadow-sm"
                  placeholder="Search projects, clients..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
            <div className="max-h-[550px] overflow-y-auto pr-2 border border-slate-50 rounded-lg p-2 bg-slate-50/30">
              {filteredProjects.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-8">
                  {projects.length === 0 ? "No projects yet." : "No matching projects found."}
                </div>
              ) : (
                <ul className="space-y-3">
                  {filteredProjects.map((p) => (
                  <li key={p.id} className="border rounded">
                    <div className="flex items-center justify-between p-3">
                      <div className="flex items-center gap-4">
                        <button
                          className="text-slate-400 hover:text-blue-600 transition-colors"
                          onClick={() => toggleProject(p.id)}
                          aria-expanded={!!expanded[p.id]}
                        >
                          {expanded[p.id] ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                        </button>
                        <div>
                          <div className="flex items-center gap-2">
                            {editingProjectId === p.id ? (
                              <div className="flex items-center gap-2">
                                <Input
                                  className="h-7 text-sm w-48 py-1"
                                  value={editingProjectName}
                                  onChange={(e) => setEditingProjectName(e.target.value)}
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') saveProjectName(p.id);
                                    if (e.key === 'Escape') setEditingProjectId(null);
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                />
                                <Button size="sm" className="h-7 px-2 bg-indigo-600 hover:bg-indigo-700 text-white" onClick={(e) => { e.stopPropagation(); saveProjectName(p.id); }}>Save</Button>
                                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={(e) => { e.stopPropagation(); setEditingProjectId(null); }}>Cancel</Button>
                              </div>
                            ) : (
                              <>
                                <span className="font-extrabold text-slate-800">{p.name}</span>
                                <Badge className={cn("ml-2 text-[10px] font-bold border-none", getProjectStatusMeta(p.project_status).color)}>
                                  {getProjectStatusMeta(p.project_status).label}
                                </Badge>
                                <button
                                  className="text-slate-400 hover:text-indigo-600 transition-colors ml-1"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingProjectId(p.id);
                                    setEditingProjectName(p.name);
                                  }}
                                  title="Edit Project Name"
                                >
                                  <Pencil size={14} />
                                </button>
                              </>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-1">
                            <span className="flex items-center gap-1 font-medium"><User className="w-3 h-3 text-slate-400" /> {p.client || "—"}</span>
                            <span className="flex items-center gap-1 font-medium"><MapPin className="w-3 h-3 text-slate-400" /> {p.location || "—"}</span>
                            <span className="flex items-center gap-1 font-medium"><Calculator className="w-3 h-3 text-slate-400" /> {p.budget || "—"}</span>
                            {p.gst_no && <span className="flex items-center gap-1 font-medium"><Receipt className="w-3 h-3 text-slate-400" /> {p.gst_no}</span>}
                            
                            <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2 ml-auto">
                              {p.bom_version_number && (
                                <div className="flex items-center gap-1.5 flex-wrap justify-end bg-white p-1 rounded border border-slate-100 shadow-sm">
                                  <span className="bg-indigo-50 text-indigo-700 text-[9px] px-1.5 py-0.5 rounded font-bold border border-indigo-200 uppercase tracking-tight">
                                    BOM V{p.bom_version_number}
                                  </span>
                                  {p.bom_version_price && (
                                    <span className="flex items-center gap-1 font-extrabold text-slate-700 text-[11px] px-1">
                                      <Calculator className="w-3 h-3 text-indigo-400" /> ₹{parseFloat(p.bom_version_price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                  )}
                                </div>
                              )}
                              {p.boq_version_number && (
                                <div className="flex items-center gap-1.5 flex-wrap justify-end bg-white p-1 rounded border border-slate-100 shadow-sm">
                                  <span className="bg-blue-50 text-blue-700 text-[9px] px-1.5 py-0.5 rounded font-bold border border-blue-200 uppercase tracking-tight">
                                    BOQ V{p.boq_version_number}
                                  </span>
                                  {p.boq_version_price && (
                                    <span className="flex items-center gap-1 font-extrabold text-green-700 text-[11px] px-1">
                                      <Calculator className="w-3 h-3 text-green-500" /> ₹{parseFloat(p.boq_version_price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                  )}
                                </div>
                              )}
                              {!p.bom_version_number && !p.boq_version_number && (
                                <span className="bg-slate-100 text-slate-600 text-[9px] px-1.5 py-0.5 rounded font-bold border border-slate-200 uppercase tracking-tight">
                                  Draft / Started
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 px-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-indigo-500 hover:bg-indigo-50 hover:text-indigo-700"
                          onClick={(e) => { e.stopPropagation(); handleClone(p); }}
                          title="Clone Project"
                        >
                          <Copy size={16} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                          onClick={() => setEditingProjectData(p)}
                          title="Edit Project Details"
                        >
                          <Pencil size={16} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-red-500 hover:bg-red-50"
                          onClick={() => deleteProject(p.id)}
                        >
                          <Trash2 size={16} />
                        </Button>
                      </div>
                    </div>

                    {expanded[p.id] && (
                      <div className="p-3 border-t">
                        {projectVersions[p.id] ? (
                          projectVersions[p.id].length === 0 ? (
                            <div className="text-sm text-muted-foreground">
                              No versions for this project.
                            </div>
                          ) : (
                            <div className="space-y-4">
                              {projectVersions[p.id].map((v: any) => (
                                <div key={v.id} className="border rounded p-3 bg-gray-50 flex items-start gap-3">
                                  <input
                                    type="checkbox"
                                    checked={selectedVersions.has(v.id)}
                                    onChange={(e) => {
                                      const newSelected = new Set(selectedVersions);
                                      if (e.target.checked) {
                                        newSelected.add(v.id);
                                      } else {
                                        newSelected.delete(v.id);
                                      }
                                      setSelectedVersions(newSelected);
                                    }}
                                    className="mt-1 w-4 h-4 cursor-pointer"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-2">
                                      <div className="font-medium">
                                        V{v.version_number}
                                      </div>
                                      <div
                                        className={`text-xs px-2 py-0.5 rounded ${v.status === "submitted" ? "bg-green-100 text-green-800" : "bg-gray-100 text-muted-foreground"}`}
                                      >
                                        {v.status}
                                      </div>
                                    </div>

                                    {v.status === "submitted" ? (
                                      <div className="mb-2">
                                        {versionItems[v.id] ? (
                                          versionItems[v.id].length > 0 ? (
                                            renderStep11Table(versionItems[v.id])
                                          ) : (
                                            <div className="text-sm text-muted-foreground">
                                              No items in this version
                                            </div>
                                          )
                                        ) : (
                                          <div className="text-sm text-muted-foreground">
                                            Loading items...
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="mb-2">
                                        {versionItems[v.id] ? (
                                          versionItems[v.id].length > 0 ? (
                                            renderStep11Table(versionItems[v.id])
                                          ) : (
                                            <div className="text-sm text-muted-foreground">
                                              No items added yet
                                            </div>
                                          )
                                        ) : (
                                          <div className="text-sm text-muted-foreground">
                                            Loading items...
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )
                        ) : (
                          <div className="text-sm text-muted-foreground">
                            Loading versions...
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!editingProjectData} onOpenChange={(open) => !open && setEditingProjectData(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
          </DialogHeader>
          {editingProjectData && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
              <div className="space-y-1.5 group">
                <Label className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1.5">
                  <Briefcase className="w-3 h-3 text-slate-400" /> Project Name
                </Label>
                <Input
                  value={editingProjectData.name}
                  onChange={(e) => setEditingProjectData({ ...editingProjectData, name: e.target.value })}
                  placeholder="Enter project name..."
                  className="border-slate-200 focus:border-slate-400 transition-all rounded-md"
                />
              </div>
              <div className="space-y-1.5 group">
                <Label className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1.5">
                  <User className="w-3 h-3 text-slate-400" /> Client Name
                </Label>
                <Input
                  value={editingProjectData.client || ""}
                  onChange={(e) => setEditingProjectData({ ...editingProjectData, client: e.target.value })}
                  placeholder="Full name of the client"
                  className="border-slate-200 focus:border-slate-400 transition-all rounded-md"
                />
              </div>
              <div className="space-y-1.5 group">
                <Label className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1.5">
                  <Receipt className="w-3 h-3 text-slate-400" /> GST No.
                </Label>
                <Input
                  value={editingProjectData.gst_no || ""}
                  onChange={(e) => setEditingProjectData({ ...editingProjectData, gst_no: e.target.value })}
                  placeholder="GSTIN (Optional)"
                  className="border-slate-200 focus:border-slate-400 transition-all rounded-md"
                />
              </div>
              <div className="space-y-1.5 group">
                <Label className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1.5">
                  <Clock className="w-3 h-3 text-slate-400" /> Project Status
                </Label>
                <Select
                  value={editingProjectData.project_status || "bom_stage"}
                  onValueChange={(val) => setEditingProjectData({ ...editingProjectData, project_status: val })}
                >
                  <SelectTrigger className="border-slate-200 rounded-md h-10 bg-white">
                    <SelectValue placeholder="Select Status" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROJECT_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5 group">
                <Label className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1.5">
                  <MapPin className="w-3 h-3 text-slate-400" /> Project Location
                </Label>
                <Input
                  value={editingProjectData.location || ""}
                  onChange={(e) => setEditingProjectData({ ...editingProjectData, location: e.target.value })}
                  placeholder="City / Site Area"
                  className="border-slate-200 focus:border-slate-400 transition-all rounded-md"
                />
              </div>
              <div className="space-y-1.5 group md:col-span-2">
                <Label className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1.5">
                  <Building2 className="w-3 h-3 text-slate-400" /> Client Billing Address
                </Label>
                <Input
                  value={editingProjectData.client_address || ""}
                  onChange={(e) => setEditingProjectData({ ...editingProjectData, client_address: e.target.value })}
                  placeholder="Detailed address for reports and invoices"
                  className="border-slate-200 focus:border-slate-400 transition-all rounded-md"
                />
              </div>
              <div className="space-y-1.5 group">
                <Label className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1.5">
                  <Calculator className="w-3 h-3 text-slate-400" /> Target Budget
                </Label>
                <Input
                  value={editingProjectData.budget || ""}
                  onChange={(e) => setEditingProjectData({ ...editingProjectData, budget: e.target.value })}
                  placeholder="Allocated budget..."
                  className="border-slate-200 focus:border-slate-400 transition-all rounded-md"
                />
              </div>
              <div className="space-y-1.5 group">
                <Label className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1.5">
                  <Receipt className="w-3 h-3 text-slate-400" /> Project Value
                </Label>
                <Input
                  value={editingProjectData.project_value || ""}
                  onChange={(e) => setEditingProjectData({ ...editingProjectData, project_value: e.target.value })}
                  placeholder="Final contract value..."
                  className="border-slate-200 focus:border-slate-400 transition-all rounded-md"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingProjectData(null)}>Cancel</Button>
            <Button onClick={saveFullProject} className="bg-slate-800 hover:bg-slate-900 text-white">Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isCloneOpen} onOpenChange={setIsCloneOpen}>
        <DialogContent className="max-w-md bg-white">
          <DialogHeader className="border-b border-slate-100 pb-3 mb-3">
            <DialogTitle className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Copy className="w-5 h-5 text-blue-600" />
              Clone Project
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700 uppercase">New Project Name</Label>
              <Input
                value={cloneNewName}
                onChange={(e) => setCloneNewName(e.target.value)}
                placeholder="Name for the cloned project"
                className="font-semibold text-slate-900 border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-md h-10"
              />
            </div>

            <div className="space-y-3">
              <Label className="text-xs font-bold text-slate-700 uppercase">Select BOM Versions to Clone</Label>
              <div className="max-h-32 overflow-y-auto space-y-2 border rounded-md p-2 bg-slate-50">
                {cloneBomVersions.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No BOM versions found</p>
                ) : (
                  cloneBomVersions.map((v) => (
                    <div key={v.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`bom-${v.id}`}
                        checked={cloneSelectedBoms.has(v.id)}
                        onCheckedChange={(checked) => {
                          const next = new Set(cloneSelectedBoms);
                          if (checked) next.add(v.id);
                          else next.delete(v.id);
                          setCloneSelectedBoms(next);
                        }}
                      />
                      <label htmlFor={`bom-${v.id}`} className="text-xs font-medium cursor-pointer">
                        Version {v.version_number} ({v.status})
                      </label>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-xs font-bold text-slate-700 uppercase">Select BOQ Versions to Clone</Label>
              <div className="max-h-32 overflow-y-auto space-y-2 border rounded-md p-2 bg-slate-50">
                {cloneBoqVersions.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No BOQ versions found</p>
                ) : (
                  cloneBoqVersions.map((v) => (
                    <div key={v.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`boq-${v.id}`}
                        checked={cloneSelectedBoqs.has(v.id)}
                        onCheckedChange={(checked) => {
                          const next = new Set(cloneSelectedBoqs);
                          if (checked) next.add(v.id);
                          else next.delete(v.id);
                          setCloneSelectedBoqs(next);
                        }}
                      />
                      <label htmlFor={`boq-${v.id}`} className="text-xs font-medium cursor-pointer">
                        Version {v.version_number} ({v.status})
                      </label>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="text-[11px] text-slate-600 p-3 bg-blue-50/50 rounded-lg border border-blue-100/50 leading-relaxed shadow-sm">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                <span className="font-bold text-blue-900 uppercase tracking-tight">Cloning Details</span>
              </div>
              <p>Cloning will create a new project duplicating all metadata (Client, Budget, Location, etc).</p>
              <p className="mt-1">Each selected version will be copied over to the new project. If multiple are selected, they will all be added.</p>
            </div>
          </div>
          <DialogFooter className="mt-6 border-t border-slate-100 pt-4">
            <Button variant="outline" onClick={() => setIsCloneOpen(false)} disabled={isCloning} className="border-slate-300">
              Cancel
            </Button>
            <Button onClick={executeClone} disabled={isCloning || !cloneNewName.trim()} className="bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-200">
              {isCloning ? "Cloning Project..." : "Clone Project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

