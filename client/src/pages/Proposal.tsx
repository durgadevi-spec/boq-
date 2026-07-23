import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/Layout";
import { SupplierLayout } from "@/components/layout/SupplierLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, Send, Clock, CheckCircle, Plus, Search, Trash2 } from "lucide-react";
import apiFetch from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import ProductPicker from "@/components/ProductPicker";
import MaterialPicker from "@/components/MaterialPicker";
import Step11Preview from "@/components/Step11Preview";

export default function Proposal({ params }: { params?: { projectId?: string } }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isSupplier = user?.role === "supplier";
  const LayoutComponent = isSupplier ? SupplierLayout : Layout;

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(params?.projectId || null);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [editedItems, setEditedItems] = useState<Record<string, any>>({});

  const [showProductPicker, setShowProductPicker] = useState(false);
  const [showMaterialPicker, setShowMaterialPicker] = useState(false);
  const [showStep11Preview, setShowStep11Preview] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [isAddingItems, setIsAddingItems] = useState(false);
  const [shopName, setShopName] = useState("");
  const [shopLocation, setShopLocation] = useState("");

  // Load the supplier's shop name/location for the sidebar header (same source as other supplier pages)
  useEffect(() => {
    if (!isSupplier) return;
    (async () => {
      try {
        const token = localStorage.getItem("authToken");
        const response = await fetch("/api/supplier/my-shops", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) return;
        const data = await response.json();
        const supplierShops = data.shops || [];
        const primaryShop = supplierShops.find((s: any) => s.approved === true) || supplierShops[0];
        if (primaryShop) {
          setShopName(primaryShop.name);
          setShopLocation(primaryShop.location || "");
        }
      } catch {
        // silently ignore; sidebar just falls back to blank as before
      }
    })();
  }, [isSupplier]);

  // Parse URL params
  useEffect(() => {
    const qs = window.location.search;
    const urlParams = new URLSearchParams(qs);

    // Extract projectId from path if available
    let pid = params?.projectId;

    // If not in params, try to extract from URL path
    if (!pid) {
      const pathMatch = window.location.pathname.match(/\/proposal\/([^/?]+)/);
      if (pathMatch && pathMatch[1]) {
        pid = pathMatch[1];
      }
    }

    // Also check query string as fallback
    if (!pid) {
      pid = urlParams.get("project") || urlParams.get("projectId");
    }

    const vid = urlParams.get("versionId") || urlParams.get("proposalId");

    if (pid && !selectedProjectId) setSelectedProjectId(pid);
    if (vid && !selectedProposalId) setSelectedProposalId(vid);
  }, [params?.projectId, selectedProjectId, selectedProposalId]);

  // Fetch Projects
  const { data: rawProjects = [], isLoading: loadingProjects } = useQuery({
    queryKey: ["/api/boq-projects"],
    queryFn: async () => {
      const res = await apiFetch("/api/boq-projects");
      if (!res.ok) throw new Error("Failed to load projects");
      const data = await res.json();
      return Array.isArray(data) ? data : data.projects || [];
    }
  });

  const projects = Array.isArray(rawProjects) ? rawProjects : [];

  // Fetch Proposals for Vendor/Project
  const { data: rawProposals = [], isLoading: loadingProposals } = useQuery({
    queryKey: ["/api/proposals", selectedProjectId],
    queryFn: async () => {
      const res = await apiFetch(`/api/proposals?projectId=${selectedProjectId || ""}`);
      if (!res.ok) throw new Error("Failed to load proposals");
      const data = await res.json();
      return Array.isArray(data) ? data : data.proposals || [];
    },
    enabled: !!selectedProjectId
  });

  const proposals = Array.isArray(rawProposals) ? rawProposals : [];
  const selectedProposal = proposals.find((p: any) => p.id === selectedProposalId);

  // Fetch Proposal Items
  const { data: rawItems = [], isLoading: loadingItems } = useQuery({
    queryKey: ["/api/proposals", selectedProposalId, "items"],
    queryFn: async () => {
      const res = await apiFetch(`/api/proposals/${selectedProposalId}/items`);
      if (!res.ok) throw new Error("Failed to load items");
      const data = await res.json();
      return Array.isArray(data) ? data : data.items || [];
    },
    enabled: !!selectedProposalId
  });

  const items = Array.isArray(rawItems) ? rawItems : [];

  const submitMutation = useMutation({
    mutationFn: async () => {
      const updates = Object.values(editedItems);
      const res = await apiFetch(`/api/proposals/${selectedProposalId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: updates.length > 0 ? updates : undefined })
      });
      if (!res.ok) throw new Error("Submission failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Proposal Submitted", description: "Your proposal is now pending approval." });
      queryClient.invalidateQueries({ queryKey: ["/api/proposals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/proposals", selectedProposalId, "items"] });
    },
    onError: () => toast({ title: "Error", description: "Failed to submit proposal", variant: "destructive" })
  });

  // Auto select logic
  useEffect(() => {
    if (proposals.length > 0 && !selectedProposalId) {
      setSelectedProposalId(proposals[0].id);
    }
  }, [proposals, selectedProposalId]);

  const handleEdit = (id: string, field: string, value: any) => {
    setEditedItems(prev => {
      const existing = prev[id] || items.find((i: any) => i.id === id) || { id };
      const next = { ...existing, [field]: value };

      // Auto calc amount
      if (field === "rate" || field === "qty") {
        next.amount = Number(next.qty || 0) * Number(next.rate || 0);
      }
      return { ...prev, [id]: next };
    });
  };

  const handleAddProduct = () => {
    if (!selectedProjectId || !selectedProposalId) {
      toast({ title: "Select Proposal", description: "Please select a project and proposal first.", variant: "destructive" });
      return;
    }
    setShowProductPicker(true);
  };

  const handleAddManualItem = () => {
    if (!selectedProjectId || !selectedProposalId) {
      toast({ title: "Select Proposal", description: "Please select a project and proposal first.", variant: "destructive" });
      return;
    }
    setShowMaterialPicker(true);
  };

  const handleSelectProduct = (product: any) => {
    setSelectedProduct(product);
    setShowStep11Preview(true);
  };

  const handleSelectMaterial = async (template: any) => {
    const qtyStr = prompt("Enter quantity to add", "1");
    if (qtyStr === null) return;
    const qty = Number(qtyStr);
    if (!qty || qty <= 0) {
      toast({ title: "Error", description: "Invalid quantity", variant: "destructive" });
      return;
    }

    setIsAddingItems(true);
    try {
      const res = await apiFetch(`/api/proposals/${selectedProposalId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          material_id: template.id,
          item_name: template.name,
          qty,
          unit: template.unit || template.uom || "nos",
          rate: template.rate || 0,
          description: template.technicalspecification || template.description || ""
        })
      });

      if (res.ok) {
        toast({ title: "Item Added", description: `${template.name} added to proposal.` });
        queryClient.invalidateQueries({ queryKey: ["/api/proposals", selectedProposalId, "items"] });
      } else {
        throw new Error("Failed to add item");
      }
    } catch (err) {
      toast({ title: "Error", description: "Failed to add item to proposal", variant: "destructive" });
    } finally {
      setIsAddingItems(false);
      setShowMaterialPicker(false);
    }
  };

  const handleAddToProposal = async (selectedItems: any[]) => {
    if (!selectedProposalId) return;
    setShowStep11Preview(false);
    setIsAddingItems(true);

    try {
      toast({ title: "Adding Items", description: `Adding ${selectedItems.length} items to proposal...` });

      // We'll call the endpoint for each item. 
      // In a production app, a batch endpoint would be better.
      for (const item of selectedItems) {
        await apiFetch(`/api/proposals/${selectedProposalId}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            material_id: item.id,
            item_name: item.title,
            qty: item.qty || 1,
            unit: item.unit || "nos",
            rate: item.rate || 0,
            description: item.description || ""
          })
        });
      }

      toast({ title: "Success", description: "Items added to proposal successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/proposals", selectedProposalId, "items"] });
    } catch (err) {
      toast({ title: "Error", description: "Failed to add some items", variant: "destructive" });
    } finally {
      setIsAddingItems(false);
      setSelectedProduct(null);
    }
  };

  const getVal = (id: string, field: string, defaultVal: any) => {
    if (editedItems[id] && editedItems[id][field] !== undefined) {
      return editedItems[id][field];
    }
    return defaultVal;
  };

  const isLocked = selectedProposal?.status && selectedProposal.status !== 'draft';

  return (
    <LayoutComponent {...(isSupplier ? { shopName, shopLocation, shopApproved: true } : {})}>
      <div className="bg-slate-50 min-h-screen p-6 pb-32">
        <div className="max-w-7xl mx-auto space-y-6">
          <header className="flex justify-between items-center border-b pb-4 border-slate-200">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">My Proposals</h1>
              <p className="text-muted-foreground text-sm">Review sketch items and finalize your rates.</p>
            </div>
          </header>

          <Card className="shadow-sm">
            <CardContent className="p-4 flex flex-wrap gap-4 items-end bg-white">
              <div className="w-full md:w-1/3">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Project</label>
                <Select value={selectedProjectId || ""} onValueChange={setSelectedProjectId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="w-full md:w-1/3">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Proposal Version</label>
                <Select value={selectedProposalId || ""} onValueChange={setSelectedProposalId} disabled={!selectedProjectId}>
                  <SelectTrigger>
                    <SelectValue placeholder={proposals.length ? "Select version" : "No proposals available"} />
                  </SelectTrigger>
                  <SelectContent>
                    {proposals.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>
                        Version {p.version_number} - {p.status?.toUpperCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedProposal && (
                <div className="ml-auto flex items-center gap-3">
                  {isSupplier && (
                    <div className="flex gap-2">
                      <Button
                        onClick={handleAddProduct}
                        variant="outline"
                        className="h-10 border-blue-200 text-blue-600 hover:bg-blue-50 font-bold"
                        disabled={isLocked || isAddingItems}
                      >
                        <Plus className="h-4 w-4 mr-2" /> Add Product
                      </Button>
                      <Button
                        onClick={handleAddManualItem}
                        variant="outline"
                        className="h-10 border-slate-200 text-slate-600 hover:bg-slate-50 font-bold"
                        disabled={isLocked || isAddingItems}
                      >
                        <Plus className="h-4 w-4 mr-2" /> Add Item
                      </Button>
                    </div>
                  )}
                  <Badge
                    variant={selectedProposal.status === 'approved' ? 'default' : 'secondary'}
                    className={selectedProposal.status === 'approved' ? 'bg-green-600 h-10 px-4' : 'h-10 px-4'}
                  >
                    Status: {selectedProposal.status?.toUpperCase()}
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>

          {selectedProposalId && (
            <div className="border rounded-md bg-white shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Item Name</th>
                      <th className="px-4 py-3 text-left font-semibold">Description</th>
                      <th className="px-4 py-3 text-center font-semibold">Qty</th>
                      <th className="px-4 py-3 text-center font-semibold text-xs text-muted-foreground">Unit</th>
                      <th className="px-4 py-3 text-right font-semibold">Rate (₹)</th>
                      <th className="px-4 py-3 text-right font-semibold">Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {loadingItems ? (
                      <tr><td colSpan={6} className="text-center py-8"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></td></tr>
                    ) : items.length === 0 ? (
                      <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No items in this proposal.</td></tr>
                    ) : items.map((item: any) => (
                      <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 font-medium">{item.item_name}</td>
                        <td className="px-4 py-3">
                          <input
                            value={getVal(item.id, "description", item.description || "")}
                            onChange={e => handleEdit(item.id, "description", e.target.value)}
                            disabled={isLocked}
                            className="w-full border rounded px-2 py-1 text-sm bg-transparent"
                            placeholder="Add description..."
                          />
                        </td>
                        <td className="px-4 py-3 text-center font-medium bg-slate-50/50">
                          <input
                            type="number"
                            value={getVal(item.id, "qty", item.qty || 0)}
                            onChange={e => handleEdit(item.id, "qty", Number(e.target.value))}
                            disabled={isLocked}
                            className="w-20 border rounded px-2 py-1 text-center text-sm bg-transparent font-bold"
                          />
                        </td>
                        <td className="px-4 py-3 text-center text-xs">{item.unit}</td>
                        <td className="px-4 py-3">
                          <div className="relative">
                            <span className="absolute left-2 top-1.5 text-slate-400">₹</span>
                            <input
                              type="number"
                              value={getVal(item.id, "rate", item.rate || 0)}
                              onChange={e => handleEdit(item.id, "rate", Number(e.target.value))}
                              disabled={isLocked}
                              placeholder="Enter your rate"
                              className={`w-full pl-6 pr-2 py-1 text-right border rounded font-medium focus:ring-1 transition-all ${getVal(item.id, "rate", item.rate) == 0
                                  ? 'bg-amber-50 border-amber-300 text-amber-800 placeholder:text-amber-500'
                                  : 'bg-transparent'
                                }`}
                            />
                            {getVal(item.id, "rate", item.rate) == 0 && !isLocked && (
                              <span className="absolute -right-1 -top-1 flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                              </span>
                            )}
                          </div>
                          {getVal(item.id, "rate", item.rate) == 0 && !isLocked && (
                            <div className="text-[10px] text-amber-700 mt-1 font-medium">
                              ⚠️ Enter your rate — must be approved
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-slate-700 bg-slate-50/50">
                          ₹{(getVal(item.id, "amount", item.amount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="p-4 border-t bg-slate-50 flex justify-between items-center">
                <div className="text-lg font-bold">
                  Total Value: ₹
                  {items.reduce((sum: number, it: any) => sum + Number(getVal(it.id, "amount", it.amount) || 0), 0)
                    .toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>

                {!isLocked && items.length > 0 && (
                  <Button
                    onClick={() => submitMutation.mutate()}
                    disabled={submitMutation.isPending || items.some((it: any) => getVal(it.id, "rate", it.rate) == 0)}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {submitMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                    Finalize & Submit Proposal
                  </Button>
                )}
                {isLocked && (
                  <div className="flex items-center gap-2 text-sm text-amber-700 font-medium bg-amber-50 px-3 py-1.5 rounded-md border border-amber-200">
                    <Clock className="h-4 w-4" /> Property locked (Status: {selectedProposal.status?.toUpperCase()})
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <ProductPicker
        open={showProductPicker}
        onOpenChange={setShowProductPicker}
        onSelectProduct={handleSelectProduct}
        selectedProjectId={selectedProjectId!}
      />
      <MaterialPicker
        open={showMaterialPicker}
        onOpenChange={setShowMaterialPicker}
        onSelectTemplate={handleSelectMaterial}
        vendorShopId={selectedProposal?.vendor_id}
      />
      {selectedProduct && (
        <Step11Preview
          product={selectedProduct}
          open={showStep11Preview}
          onClose={() => { setShowStep11Preview(false); setTimeout(() => setSelectedProduct(null), 300); }}
          onAddToBoq={handleAddToProposal}
        />
      )}
    </LayoutComponent>
  );
}