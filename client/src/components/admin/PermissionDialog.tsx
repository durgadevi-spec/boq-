import { useState, useEffect } from "react";
import apiFetch from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { UserCog, Save, Loader2, ChevronRight, Building2, Search, Maximize2, Minimize2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import { ALL_SIDEBAR_MODULES, PERMISSION_GROUPS, getDefaultPermissions } from "@/lib/permissions";

interface Project {
  id: string;
  name: string;
  client?: string;
}

interface PermissionDialogProps {
  user: { id: string; username: string; role: string; modules?: string[]; projects?: string[] } | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const labelMap = Object.fromEntries(ALL_SIDEBAR_MODULES.map((m) => [m.key, m.label]));

// Keys that are sub-permissions (indented under their parent)
const SUB_KEYS = new Set([
  "create_product_category",
  "create_product_subcategory",
  "create_product_product",
  "manage_product_work",
  "manage_product_approval",
  "manage_product_edit_locked",
]);

const SUB_SUB_KEYS = new Set([
  "create_product_category_add",
  "create_product_category_edit",
  "create_product_category_delete",
  "create_product_subcategory_add",
  "create_product_subcategory_edit",
  "create_product_subcategory_delete",
  "create_product_product_add",
  "create_product_product_edit",
  "create_product_product_delete",
]);

export function PermissionDialog({ user, open, onClose, onSaved }: PermissionDialogProps) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [projectSearch, setProjectSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("modules");
  const [moduleSearch, setModuleSearch] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (!open || !user) return;

    setLoading(true);
    // Fetch permissions (modules) and project assignments
    const fetchPerms = apiFetch(`/api/admin/dynamic-access/permissions/${user.id}`).then(r => r.json());
    const fetchProjects = apiFetch("/api/boq-projects?all=true").then(r => r.json());

    Promise.all([fetchPerms, fetchProjects])
      .then(([permData, projectData]) => {
        if (permData.modules && permData.modules.length > 0) {
          setSelected(new Set(permData.modules));
        } else {
          setSelected(new Set(getDefaultPermissions(user.role)));
        }

        // Project assignments can be null or empty
        if (user.projects) {
          setSelectedProjects(new Set(user.projects));
        } else if (permData.projects) {
          setSelectedProjects(new Set(permData.projects));
        } else {
          setSelectedProjects(new Set());
        }

        setAllProjects(projectData.projects || []);
      })
      .catch((err) => {
        console.error("Failed to load permissions/projects:", err);
        setSelected(new Set(getDefaultPermissions(user.role)));
      })
      .finally(() => setLoading(false));
  }, [open, user]);

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleProject = (projectId: string) => {
    setSelectedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(ALL_SIDEBAR_MODULES.map((m) => m.key)));
  const clearAll = () => setSelected(new Set());

  const selectAllProjects = () => setSelectedProjects(new Set(allProjects.map(p => p.id)));
  const clearAllProjects = () => setSelectedProjects(new Set());

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/admin/dynamic-access/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          modules: Array.from(selected),
          projects: Array.from(selectedProjects)
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast({ title: "Access updated", description: `Permissions and projects updated for ${user.username}` });
      window.dispatchEvent(new CustomEvent("permissions_updated", { detail: { userId: user.id } }));
      onSaved();
      onClose();
    } catch {
      toast({ title: "Error", description: "Failed to save updates", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const filteredProjects = allProjects.filter(p =>
    p.name.toLowerCase().includes(projectSearch.toLowerCase()) ||
    p.client?.toLowerCase().includes(projectSearch.toLowerCase())
  );

  // Filter module groups by search term (matches module label or section name)
  const filteredGroups = PERMISSION_GROUPS.map((group) => {
    const term = moduleSearch.trim().toLowerCase();
    if (!term) return group;
    const sectionMatches = group.section.toLowerCase().includes(term);
    if (sectionMatches) return group;
    const keys = group.keys.filter((key) => (labelMap[key] || key).toLowerCase().includes(term));
    return { ...group, keys };
  }).filter((group) => group.keys.length > 0);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className={`flex flex-col gap-2 p-4 overflow-hidden transition-all duration-200 ${isExpanded
          ? "max-w-[96vw] w-[96vw] h-[95vh] max-h-[95vh] sm:max-w-[96vw]"
          : "max-w-4xl w-full h-[85vh] max-h-[85vh]"
          }`}
      >
        <DialogHeader className="mb-0 shrink-0">
          <div className="flex items-center justify-between gap-4 pr-8">
            <div className="flex items-center gap-3 min-w-0">
              <DialogTitle className="flex items-center gap-2 text-base font-bold shrink-0">
                <UserCog className="h-4.5 w-4.5 text-primary" />
                Manage User Access
              </DialogTitle>
              {user && (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-muted-foreground shrink-0">·</span>
                  <span className="text-sm font-semibold text-foreground truncate">{user.username}</span>
                  <Badge variant="secondary" className="capitalize px-2 py-0 text-[10px] shrink-0">{user.role}</Badge>
                </div>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsExpanded((v) => !v)}
              className="h-7 text-xs font-bold gap-1.5 shrink-0"
              title={isExpanded ? "Collapse view" : "Expand to full page"}
            >
              {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              {isExpanded ? "Collapse" : "Full Page"}
            </Button>
          </div>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden min-h-0">
          <TabsList className="grid w-full grid-cols-2 mb-1.5 h-8 shrink-0">
            <TabsTrigger value="modules" className="text-xs font-semibold">Sidebar Modules</TabsTrigger>
            <TabsTrigger value="projects" className="text-xs font-semibold">Project Access</TabsTrigger>
          </TabsList>

          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center py-20 grayscale opacity-50">
              <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
              <p className="text-sm font-medium text-muted-foreground">Syncing user configuration...</p>
            </div>
          ) : (
            <>
              <TabsContent value="modules" className="flex-1 flex flex-col overflow-hidden mt-0 animate-in fade-in slide-in-from-left-4 duration-300 min-h-0">
                <div className="mb-1.5 shrink-0 flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="relative group flex-1 min-w-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                    <Input
                      placeholder="Search modules (e.g. Manage Product, Approve, Categories)..."
                      value={moduleSearch}
                      onChange={(e) => setModuleSearch(e.target.value)}
                      className="pl-10 h-8 text-sm bg-muted/20 border-border focus-visible:ring-primary/20"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 shrink-0">
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={selectAll} className="h-8 text-xs font-bold border-primary/20 hover:bg-primary/5 px-2.5">SELECT ALL</Button>
                      <Button variant="outline" size="sm" onClick={clearAll} className="h-8 text-xs font-bold border-destructive/20 hover:bg-destructive/5 text-destructive hover:text-destructive px-2.5">CLEAR ALL</Button>
                    </div>
                    <Badge variant="outline" className="h-8 px-2.5 font-mono text-[10px] tracking-tight bg-muted/30 whitespace-nowrap">
                      {selected.size} / {ALL_SIDEBAR_MODULES.length}
                    </Badge>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto pr-2 space-y-4 pb-4 custom-scrollbar min-h-0">
                  {filteredGroups.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 opacity-60">
                      <Search className="h-12 w-12 text-muted-foreground mb-3 stroke-[1.5]" />
                      <p className="text-sm font-medium">No matching modules found</p>
                    </div>
                  ) : (
                    filteredGroups.map((group) => (
                      <div key={group.section} className="group/section">
                        <div className="flex items-center gap-3 mb-2 sticky top-0 bg-background/95 backdrop-blur-sm py-0.5 z-10">
                          <span className="text-[11px] font-black uppercase tracking-[0.15em] text-primary/70">
                            {group.section}
                          </span>
                          <div className="flex-1 h-[1px] bg-gradient-to-r from-primary/20 via-primary/10 to-transparent" />
                        </div>

                        <div className="grid grid-cols-1 gap-1 pl-1">
                          {group.keys.map((key) => {
                            const isSub = SUB_KEYS.has(key);
                            const isSubSub = SUB_SUB_KEYS.has(key);
                            const label = labelMap[key] || key;
                            const isChecked = selected.has(key);

                            return (
                              <label
                                key={key}
                                className={`
                                group relative flex items-start gap-4 rounded-xl p-2.5 cursor-pointer transition-all duration-200 border
                                ${isChecked ? "bg-primary/5 border-primary/20 shadow-sm" : "bg-card hover:bg-muted/50 border-transparent hover:border-border"}
                                ${isSubSub ? "ml-10 py-2 opacity-90 scale-[0.98]" : isSub ? "ml-5 py-2" : ""}
                              `}
                              >
                                <div className="flex items-center h-full pt-0.5">
                                  <Checkbox
                                    checked={isChecked}
                                    onCheckedChange={() => toggle(key)}
                                    className={`h-4.5 w-4.5 transition-transform duration-200 ${isChecked ? "scale-110" : ""}`}
                                  />
                                </div>
                                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                  <span className={`text-sm font-bold tracking-tight transition-colors ${isChecked ? "text-primary" : "text-foreground"}`}>
                                    {isSubSub || isSub ? (
                                      <span className="flex items-center gap-1.5">
                                        {label.split("→")[1]?.trim() || label}
                                      </span>
                                    ) : label}
                                  </span>
                                  {(isSub || isSubSub) && (
                                    <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wide">
                                      {label.split("→")[0]?.trim()} Extension
                                    </span>
                                  )}
                                </div>
                                {isChecked && (
                                  <div className="absolute top-2 right-2 text-[10px] font-bold text-primary/40 pointer-events-none">ACTIVE</div>
                                )}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </TabsContent>

              <TabsContent value="projects" className="flex-1 flex flex-col overflow-hidden mt-0 animate-in fade-in slide-in-from-right-4 duration-300 min-h-0">
                <div className="mb-1.5 shrink-0 flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="relative group flex-1 min-w-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                    <Input
                      placeholder="Search projects by name or client..."
                      value={projectSearch}
                      onChange={(e) => setProjectSearch(e.target.value)}
                      className="pl-10 h-8 text-sm bg-muted/20 border-border focus-visible:ring-primary/20"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 shrink-0">
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={selectAllProjects} className="h-8 text-xs font-bold border-primary/20 hover:bg-primary/5 px-2.5">SELECT ALL</Button>
                      <Button variant="outline" size="sm" onClick={clearAllProjects} className="h-8 text-xs font-bold border-destructive/20 hover:bg-destructive/5 text-destructive hover:text-destructive px-2.5">CLEAR ALL</Button>
                    </div>
                    <Badge variant="outline" className="h-8 px-2.5 font-mono text-[10px] tracking-tight bg-muted/30 whitespace-nowrap">
                      {selectedProjects.size} / {allProjects.length}
                    </Badge>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto pr-2 space-y-2 pb-4 custom-scrollbar min-h-0">
                  {filteredProjects.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 opacity-60">
                      <Building2 className="h-12 w-12 text-muted-foreground mb-3 stroke-[1.5]" />
                      <p className="text-sm font-medium">No matching projects found</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2">
                      {filteredProjects.map((project) => {
                        const isChecked = selectedProjects.has(project.id);
                        return (
                          <label
                            key={project.id}
                            className={`
                            group relative flex items-center gap-4 rounded-xl p-4 cursor-pointer transition-all duration-200 border
                            ${isChecked ? "bg-indigo-50/50 border-indigo-200 shadow-sm" : "bg-card hover:bg-muted/50 border-transparent hover:border-border"}
                          `}
                          >
                            <Building2 className={`h-5 w-5 transition-colors ${isChecked ? "text-indigo-600" : "text-muted-foreground"}`} />
                            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                              <span className={`text-sm font-bold tracking-tight transition-colors ${isChecked ? "text-indigo-900" : "text-foreground"}`}>
                                {project.name}
                              </span>
                              {project.client && (
                                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                                  Client: {project.client}
                                </span>
                              )}
                            </div>
                            <Checkbox
                              checked={isChecked}
                              onCheckedChange={() => toggleProject(project.id)}
                              className={`h-5 w-5 transition-transform duration-200 ${isChecked ? "scale-110 border-indigo-500 bg-indigo-500" : ""}`}
                            />
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </TabsContent>
            </>
          )}
        </Tabs>

        <DialogFooter className="pt-2 mt-0 border-t border-border gap-2 shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving} className="font-bold h-8">Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving || loading} className="min-w-[130px] h-8 font-bold shadow-md">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            {saving ? "Saving Changes..." : "Save Configuration"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}