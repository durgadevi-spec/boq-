import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, CheckCircle2, XCircle, Plus, ChevronsUpDown, AlertTriangle } from "lucide-react";
import apiFetch from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { computeBoq } from "@/lib/boqCalc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type BomSketchCompareDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  projectId: string | null;
  currentBomVersionId?: string | null;
  onItemAdded?: () => void;
};

export function BomSketchCompareDialog({ isOpen, onClose, projectId, currentBomVersionId, onItemAdded }: BomSketchCompareDialogProps) {
  const [sketchPlans, setSketchPlans] = useState<any[]>([]);
  const [bomVersions, setBomVersions] = useState<any[]>([]);
  const [selectedSketchPlanId, setSelectedSketchPlanId] = useState<string>("");
  const [selectedBomVersionId, setSelectedBomVersionId] = useState<string>(currentBomVersionId || "");
  const [isComparing, setIsComparing] = useState(false);
  const [comparisonResult, setComparisonResult] = useState<any>(null);
  const [isLoadingInitial, setIsLoadingInitial] = useState(false);
  const { toast } = useToast();
  const [savedProducts, setSavedProducts] = useState<any[]>([]);
  const [savedMaterials, setSavedMaterials] = useState<any[]>([]);
  const [isAdding, setIsAdding] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && projectId) {
      if (!selectedBomVersionId && currentBomVersionId) {
        setSelectedBomVersionId(currentBomVersionId);
      }
      loadInitialData();
    } else {
      setComparisonResult(null);
    }
  }, [isOpen, projectId]);

  const loadInitialData = async () => {
    setIsLoadingInitial(true);
    try {
      // Load sketch plans for project
      const spRes = await apiFetch("/api/sketch-plans");
      if (spRes.ok) {
        const data = await spRes.json();
        const allPlans = data.plans || [];
        const rootIdsInProject = new Set<string>();
        allPlans.forEach((p: any) => {
          if (p.project_id === projectId) {
            rootIdsInProject.add(p.parent_plan_id || p.id);
          }
        });

        const plans = allPlans.filter((p: any) => rootIdsInProject.has(p.parent_plan_id || p.id));

        // Sort plans descending by version number
        plans.sort((a: any, b: any) => (b.version_number || 1) - (a.version_number || 1));

        setSketchPlans(plans);
      }

      // Load BOM versions for project
      const bomRes = await apiFetch(`/api/boq-versions/${encodeURIComponent(projectId!)}?type=bom`);
      if (bomRes.ok) {
        const data = await bomRes.json();
        setBomVersions(data.versions || []);
      }

      // Preload master data to match items
      const [prodRes, matRes] = await Promise.all([
        apiFetch("/api/products"),
        apiFetch("/api/materials")
      ]);
      if (prodRes.ok) {
        const pData = await prodRes.json();
        setSavedProducts(pData.products || []);
      }
      if (matRes.ok) {
        const mData = await matRes.json();
        setSavedMaterials(mData.materials || []);
      }
    } catch (e) {
      console.error("Failed to load compare data", e);
    } finally {
      setIsLoadingInitial(false);
    }
  };

  const handleCompare = async () => {
    if (!selectedSketchPlanId || !selectedBomVersionId) return;
    setIsComparing(true);
    try {
      // 1. Fetch Sketch Plan Items
      const spRes = await apiFetch(`/api/sketch-plans/${selectedSketchPlanId}`);
      if (!spRes.ok) throw new Error("Failed to load sketch plan items");
      const spData = await spRes.json();
      const sketchItems = spData.items || [];

      // 2. Fetch BOM Items
      const bomRes = await apiFetch(`/api/boq-items/version/${encodeURIComponent(selectedBomVersionId)}`);
      if (!bomRes.ok) throw new Error("Failed to load BOM items");
      const bomDataText = await bomRes.text();
      const bomData = JSON.parse(bomDataText);
      const boqItems = bomData.items || [];

      // Extract raw items from both
      // Sketch Map
      const sketchNameMap = new Map();
      const sketchMaterialMap = new Map();

      sketchItems.forEach((item: any) => {
        if (item.material_id) {
          sketchMaterialMap.set(item.material_id, { ...item, source: "sketch" });
        } else {
          sketchNameMap.set((item.item_name || "").toLowerCase().trim(), { ...item, source: "sketch" });
        }
      });

      // BOM Map
      const bomMaterialMap = new Map();
      const bomNameMap = new Map();

      boqItems.forEach((bi: any) => {
        const td = typeof bi.table_data === 'string' ? JSON.parse(bi.table_data) : bi.table_data;

        // Add the primary product/boq-item name itself
        if (td.product_name) {
          bomNameMap.set(td.product_name.toLowerCase().trim(), td);
        }

        if (td.materialLines) {
          td.materialLines.forEach((ml: any) => {
            const mId = ml.id || ml.materialId;
            if (mId) bomMaterialMap.set(mId, ml);
            else bomNameMap.set((ml.name || ml.materialName || "").toLowerCase().trim(), ml);
          });
        }
        if (td.step11_items) {
          td.step11_items.forEach((s11: any) => {
            if (s11.material_id || s11.id) bomMaterialMap.set(s11.material_id || s11.id, s11);
            else bomNameMap.set((s11.title || s11.description || "").toLowerCase().trim(), s11);
          });
        }
      });

      // Perform Comparison logic
      const result = {
        inBoth: [] as any[],
        missingInBom: [] as any[],
        qtyMismatch: [] as any[],
        onlyInBom: [] as any[]
      };

      // Aggregate Sketch Items by material_id or name
      const sketchAgg = new Map();
      sketchItems.forEach((item: any) => {
        const key = item.material_id || (item.item_name || "").toLowerCase().trim();
        const existing = sketchAgg.get(key);
        if (existing) {
          existing.qty += (Number(item.qty) || 0);
        } else {
          sketchAgg.set(key, { ...item, qty: Number(item.qty) || 0 });
        }
      });

      // Aggregate BOM Items by material_id or name
      const bomAgg = new Map();
      boqItems.forEach((bi: any) => {
        const td = typeof bi.table_data === 'string' ? JSON.parse(bi.table_data) : bi.table_data;
        const targetQty = Number(td.targetRequiredQty) || 0;

        // 1. Material Lines (Engine Products)
        if (td.configBasis && td.materialLines && targetQty > 0) {
          try {
            const boqResult = computeBoq(td.configBasis, td.materialLines, targetQty);
            boqResult.computed.forEach(line => {
              const key = line.id || line.materialId || (line.name || "").toLowerCase().trim();
              bomAgg.set(key, (bomAgg.get(key) || 0) + (line.roundOffQty || 0));
            });
          } catch (err) {
            console.error("computeBoq failed in comparison", err);
          }
        }

        // 2. Step 11 Items (Manual or fallback)
        if (td.step11_items) {
          td.step11_items.forEach((s11: any) => {
            const mId = s11.material_id || s11.id;
            const key = mId || (s11.title || s11.description || "").toLowerCase().trim();
            const qty = Number(s11.qty || s11.roundOff || 0);
            bomAgg.set(key, (bomAgg.get(key) || 0) + qty);
          });
        }

        // 3. Products themselves (if the product name itself matches a sketch item)
        if (td.product_name) {
          const key = td.product_id || td.product_name.toLowerCase().trim();
          bomAgg.set(key, (bomAgg.get(key) || 0) + targetQty);
        }
      });

      // Check Sketch Aggregation against BOM Aggregation
      for (const [key, sItem] of sketchAgg.entries()) {
        const mId = sItem.material_id;
        const name = (sItem.item_name || "").toLowerCase().trim();
        const originalName = sItem.item_name || "Unknown Sketch Item";

        let bomQty = bomAgg.get(key);
        let foundInBom = (bomQty !== undefined);

        if (!foundInBom && name) {
          // Fallback name matching if key didn't match
          for (const [bKey, bQty] of bomAgg.entries()) {
            if (typeof bKey === 'string' && (name.includes(bKey) || bKey.includes(name)) && bKey.length > 3) {
              foundInBom = true;
              bomQty = bQty;
              break;
            }
          }
        }

        let itemType = "Unmapped";
        const searchNm = originalName.toLowerCase();
        const matchedMat = mId ? true : savedMaterials.some(m => m.name.toLowerCase() === searchNm || searchNm.includes(m.name.toLowerCase()));
        const matchedProd = savedProducts.some(p => p.name.toLowerCase() === searchNm || searchNm.includes(p.name.toLowerCase()));

        if (matchedProd) itemType = "Product";
        else if (matchedMat) itemType = "Material";

        if (!foundInBom) {
          result.missingInBom.push({ id: sItem.id, name: originalName, category: sItem.category, material_id: mId, qty: sItem.qty, itemType });
        } else {
          // Check for quantity mismatch
          const diff = Math.abs((bomQty || 0) - sItem.qty);
          if (diff > 0.01) {
            result.qtyMismatch.push({
              id: sItem.id,
              name: originalName,
              category: sItem.category,
              sketchQty: sItem.qty,
              bomQty,
              diff: (bomQty || 0) - sItem.qty,
              itemType
            });
          } else {
            result.inBoth.push({ id: sItem.id, name: originalName, category: sItem.category, qty: sItem.qty, itemType });
          }
        }
      }

      setComparisonResult(result);

    } catch (e) {
      console.error("Comparison failed", e);
    } finally {
      setIsComparing(false);
    }
  };

  const handleAddMissingItem = async (item: any) => {
    setIsAdding(item.id);
    try {
      const searchName = item.name.toLowerCase();

      const matchedMat = item.material_id
        ? savedMaterials.find(m => m.id === item.material_id)
        : savedMaterials.find(m => m.name.toLowerCase() === searchName || searchName.includes(m.name.toLowerCase()));

      const matchedProd = savedProducts.find(p => p.name.toLowerCase() === searchName || searchName.includes(p.name.toLowerCase()));

      if (matchedMat && !matchedProd) {
        const qtyStr = prompt(`Enter quantity for item: ${item.name}`, item.qty?.toString() || "1");
        if (qtyStr === null) return;
        const qty = Number(qtyStr);
        if (qty <= 0 || isNaN(qty)) { toast({ title: "Error", description: "Invalid quantity", variant: "destructive" }); return; }

        const materialItem = {
          id: matchedMat.id,
          title: matchedMat.name,
          description: matchedMat.technicalspecification || matchedMat.technicalSpecification || matchedMat.name,
          unit: matchedMat.unit || "nos",
          qty,
          supply_rate: Number(matchedMat.rate ?? matchedMat.supply_rate ?? matchedMat.default_rate ?? 0),
          install_rate: 0,
          location: "Main Area",
          s_no: 1,
          shop_name: matchedMat.shop_name || matchedMat.shopName || ""
        };

        const res = await apiFetch("/api/boq-items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: projectId,
            version_id: selectedBomVersionId,
            estimator: `material_${matchedMat.id}`,
            table_data: {
              product_name: matchedMat.name,
              step11_items: [materialItem],
              hsn_sac_type: matchedMat.tax_code_type || matchedMat.taxCodeType || null,
              hsn_sac_code: matchedMat.tax_code_value || matchedMat.taxCodeValue || "",
              finalize_description: materialItem.description
            }
          })
        });
        if (res.ok) {
          toast({ title: "Success", description: `Added ${item.name} to BOM.` });
          handleCompare();
          if (onItemAdded) onItemAdded();
        } else { throw new Error("Failed to add material"); }
        return;
      }

      if (matchedProd) {
        const sqftStr = prompt(`Enter SqFt / target quantity for product: ${item.name}`, "100");
        if (sqftStr === null) return;
        const sqft = Number(sqftStr);
        if (sqft <= 0 || isNaN(sqft)) { toast({ title: "Error", description: "Invalid quantity", variant: "destructive" }); return; }

        const configRes = await apiFetch(`/api/product-step3-config/${matchedProd.id}`);
        let configBasis: any = null;
        let materialLines: any[] = [];
        let savedDescription = "";
        if (configRes.ok) {
          const { config, items } = await configRes.json();
          savedDescription = config?.description || "";
          if (config) {
            configBasis = {
              requiredUnitType: config.required_unit_type || "Sqft",
              baseRequiredQty: Math.max(0.001, Number(config.base_required_qty || 100)),
              wastagePctDefault: Number(config.wastage_pct_default || 0)
            };
          }
          if (items) {
            materialLines = items.map((it: any) => ({
              id: it.material_id,
              name: it.material_name,
              unit: it.unit,
              baseQty: Number(it.base_qty ?? it.qty ?? 0),
              wastagePct: it.wastage_pct != null ? Number(it.wastage_pct) : undefined,
              supplyRate: Number(it.supply_rate ?? it.rate ?? 0),
              installRate: Number(it.install_rate ?? 0),
              shop_name: it.shop_name
            }));
          }
        }

        if (!configBasis) {
          configBasis = { requiredUnitType: "Sqft", baseRequiredQty: 1, wastagePctDefault: 0 };
          materialLines = [];
        }

        const tableData = {
          product_name: matchedProd.name,
          product_id: matchedProd.id,
          image: matchedProd.image,
          category: matchedProd.category || item.category,
          subcategory: matchedProd.subcategory,
          hsn_sac_type: matchedProd.tax_code_type || null,
          hsn_sac_code: matchedProd.tax_code_value || null,
          hsn_code: matchedProd.hsn_code || null,
          sac_code: matchedProd.sac_code || null,
          targetRequiredQty: sqft,
          configBasis,
          materialLines,
          step11_items: [],
          finalize_description: (typeof savedDescription === 'string' && savedDescription) || item.name,
          created_at: new Date().toISOString()
        };

        const res = await apiFetch("/api/boq-items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: projectId,
            version_id: selectedBomVersionId,
            estimator: matchedProd.category || "General",
            table_data: tableData
          })
        });
        if (res.ok) {
          toast({ title: "Success", description: `Added ${item.name} to BOM.` });
          handleCompare();
          if (onItemAdded) onItemAdded();
        } else { throw new Error("Failed to add product"); }
        return;
      }

      toast({ title: "No Saved Data", description: `There is no saved data for "${item.name}".`, variant: "destructive" });
    } catch (e) {
      console.error("Add failed", e);
      toast({ title: "Error", description: "Failed to add to BOM", variant: "destructive" });
    } finally {
      setIsAdding(null);
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Compare Sketch Plan vs BOM</DialogTitle>
          <DialogDescription>
            Identify missing materials and products between your Sketch Plans and BOM versions.
          </DialogDescription>
        </DialogHeader>

        {isLoadingInitial ? (
          <div className="flex-1 flex justify-center items-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            <span className="ml-2 text-slate-500">Loading versions...</span>
          </div>
        ) : (
          <div className="flex flex-col gap-4 flex-1 overflow-hidden">
            {/* Version Selectors */}
            <div className="flex items-end gap-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
              <div className="flex-1 space-y-1">
                <label className="text-xs font-bold text-slate-600 uppercase">Sketch Plan Version</label>
                <Select value={selectedSketchPlanId} onValueChange={setSelectedSketchPlanId}>
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="Select Sketch Plan..." />
                  </SelectTrigger>
                  <SelectContent>
                    {sketchPlans.length === 0 && <SelectItem value="none" disabled>No sketch plans found</SelectItem>}
                    {sketchPlans.map(sp => (
                      <SelectItem key={sp.id} value={sp.id}>
                        {sp.name} [V{sp.version_number}] - {new Date(sp.created_at).toLocaleDateString()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 space-y-1">
                <label className="text-xs font-bold text-slate-600 uppercase">BOM Version</label>
                <Select value={selectedBomVersionId} onValueChange={setSelectedBomVersionId}>
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="Select BOM Version..." />
                  </SelectTrigger>
                  <SelectContent>
                    {bomVersions.length === 0 && <SelectItem value="none" disabled>No BOM versions found</SelectItem>}
                    {bomVersions.map(bv => (
                      <SelectItem key={bv.id} value={bv.id}>
                        V{bv.version_number} - {bv.status.toUpperCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={handleCompare}
                disabled={!selectedSketchPlanId || !selectedBomVersionId || isComparing}
                className="bg-blue-600 hover:bg-blue-700 text-white min-w-[120px]"
              >
                {isComparing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {isComparing ? "Comparing..." : "Compare"}
              </Button>
            </div>

            {/* Results Area */}
            {comparisonResult && (
              <div className="flex-1 overflow-y-auto space-y-6 pr-2">

                {/* Summary Cards */}
                <div className={`grid gap-4 ${comparisonResult.qtyMismatch.length > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                  <div className="bg-green-50 border border-green-200 p-4 rounded-xl flex items-center justify-between shadow-sm">
                    <div>
                      <h4 className="text-xs font-bold text-green-800 uppercase tracking-wider">Perfectly Matched</h4>
                      <p className="text-[10px] text-green-600 mt-1">Identical items & quantities</p>
                    </div>
                    <div className="text-3xl font-black text-green-700">{comparisonResult.inBoth.length}</div>
                  </div>

                  <div className="bg-red-50 border border-red-200 p-4 rounded-xl flex items-center justify-between shadow-sm">
                    <div>
                      <h4 className="text-xs font-bold text-red-800 uppercase tracking-wider">Missing in BOM</h4>
                      <p className="text-[10px] text-red-600 mt-1">Found in Sketch only</p>
                    </div>
                    <div className="text-3xl font-black text-red-700">{comparisonResult.missingInBom.length}</div>
                  </div>

                  {comparisonResult.qtyMismatch.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex items-center justify-between shadow-sm">
                      <div>
                        <h4 className="text-xs font-bold text-amber-800 uppercase tracking-wider">Qty Mismatch</h4>
                        <p className="text-[10px] text-amber-600 mt-1">Needs adjustment</p>
                      </div>
                      <div className="text-3xl font-black text-amber-700">{comparisonResult.qtyMismatch.length}</div>
                    </div>
                  )}
                </div>

                <Tabs defaultValue="actions" className="w-full">
                  <TabsList className="grid w-full grid-cols-2 mb-6 bg-slate-100 p-1 h-11">
                    <TabsTrigger value="actions" className="rounded-md data-[state=active]:bg-white data-[state=active]:text-blue-700 data-[state=active]:shadow-sm">
                      <div className="flex items-center gap-2 font-bold py-1">
                        <AlertTriangle className="h-4 w-4" />
                        Actions Required ({comparisonResult.missingInBom.length + comparisonResult.qtyMismatch.length})
                      </div>
                    </TabsTrigger>
                    <TabsTrigger value="matched" className="rounded-md data-[state=active]:bg-white data-[state=active]:text-green-700 data-[state=active]:shadow-sm">
                      <div className="flex items-center gap-2 font-bold py-1">
                        <CheckCircle2 className="h-4 w-4" />
                        Fully Matched ({comparisonResult.inBoth.length})
                      </div>
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="actions" className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300 outline-none">
                    {/* Missing Items List */}
                    {comparisonResult.missingInBom.length > 0 && (
                      <div>
                        <h3 className="text-sm font-bold text-red-800 flex items-center gap-2 mb-3 px-1">
                          <XCircle className="h-5 w-5" />
                          Missing Items (BOM needs these)
                        </h3>
                        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                          <table className="w-full text-sm">
                            <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200 text-left">
                              <tr>
                                <th className="px-4 py-3">Item Name</th>
                                <th className="px-4 py-3">Category</th>
                                <th className="px-4 py-3 text-center">Required Qty</th>
                                <th className="px-4 py-3 text-right">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {comparisonResult.missingInBom.map((item: any, i: number) => (
                                <tr key={i} className="hover:bg-red-50/30 transition-colors">
                                  <td className="px-4 py-3">
                                    <div className="flex flex-col gap-1">
                                      <span className="font-bold text-slate-900 leading-tight">{item.name}</span>
                                      <div className="flex gap-1">
                                        {item.itemType === 'Product' && <span className="text-[9px] bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.5 rounded uppercase">Product</span>}
                                        {item.itemType === 'Material' && <span className="text-[9px] bg-emerald-100 text-emerald-700 font-bold px-1.5 py-0.5 rounded uppercase">Material</span>}
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-slate-500 text-xs italic">{item.category || "-"}</td>
                                  <td className="px-4 py-3 text-center font-bold text-red-600">{item.qty}</td>
                                  <td className="px-4 py-3 text-right">
                                    <Button
                                      variant="default"
                                      size="sm"
                                      className="h-8 text-xs bg-blue-600 hover:bg-blue-700 shadow-sm"
                                      onClick={() => handleAddMissingItem(item)}
                                      disabled={isAdding === item.id}
                                    >
                                      {isAdding === item.id ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
                                      {isAdding === item.id ? "Adding" : "Add to BOM"}
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Quantity Mismatch List */}
                    {comparisonResult.qtyMismatch.length > 0 && (
                      <div>
                        <h3 className="text-sm font-bold text-amber-800 flex items-center gap-2 mb-3 px-1">
                          <ChevronsUpDown className="h-5 w-5" />
                          Quantity Discrepancies
                        </h3>
                        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                          <table className="w-full text-sm">
                            <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200 text-left">
                              <tr>
                                <th className="px-4 py-3">Item Name</th>
                                <th className="px-4 py-3 text-center">Sketch Qty</th>
                                <th className="px-4 py-3 text-center">BOM Qty</th>
                                <th className="px-4 py-3 text-center">Difference</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {comparisonResult.qtyMismatch.map((item: any, i: number) => (
                                <tr key={i} className="hover:bg-amber-50/30 transition-colors">
                                  <td className="px-4 py-3">
                                    <div className="flex flex-col gap-1">
                                      <span className="font-bold text-slate-900 leading-tight">{item.name}</span>
                                      <div className="flex gap-1">
                                        {item.itemType === 'Product' && <span className="text-[9px] bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.5 rounded uppercase">Product</span>}
                                        {item.itemType === 'Material' && <span className="text-[9px] bg-emerald-100 text-emerald-700 font-bold px-1.5 py-0.5 rounded uppercase">Material</span>}
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-center font-bold text-slate-600">{item.sketchQty}</td>
                                  <td className="px-4 py-3 text-center font-bold text-blue-600">{item.bomQty}</td>
                                  <td className="px-4 py-3 text-center">
                                    <span className={`inline-flex items-center gap-1 text-[11px] font-black px-2.5 py-1 rounded-full ${item.diff > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                      {item.diff > 0 ? '+' : ''}{item.diff.toFixed(2)}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {comparisonResult.missingInBom.length === 0 && comparisonResult.qtyMismatch.length === 0 && (
                      <div className="py-20 text-center bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
                        <div className="bg-green-100 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4">
                          <CheckCircle2 className="h-6 w-6 text-green-600" />
                        </div>
                        <h4 className="font-bold text-slate-900">All Good!</h4>
                        <p className="text-sm text-slate-500 max-w-xs mx-auto mt-1">Everything in this sketch plan is correctly represented in your BOM.</p>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="matched" className="animate-in fade-in slide-in-from-bottom-2 duration-300 outline-none">
                    {/* Present Items List */}
                    {comparisonResult.inBoth.length > 0 ? (
                      <div>
                        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                          <div className="max-h-[400px] overflow-y-auto">
                            <table className="w-full text-sm">
                              <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200 text-left sticky top-0 z-10">
                                <tr>
                                  <th className="px-4 py-3">Item Name</th>
                                  <th className="px-4 py-3">Category</th>
                                  <th className="px-4 py-3 text-center">Matched Qty</th>
                                  <th className="px-4 py-2 text-center">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {comparisonResult.inBoth.map((item: any, i: number) => (
                                  <tr key={i} className="hover:bg-green-50/30 transition-colors">
                                    <td className="px-4 py-3">
                                      <div className="flex flex-col gap-1">
                                        <span className="font-bold text-slate-900 leading-tight">{item.name}</span>
                                        <div className="flex gap-1">
                                          {item.itemType === 'Product' && <span className="text-[9px] bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.5 rounded uppercase">Product</span>}
                                          {item.itemType === 'Material' && <span className="text-[9px] bg-emerald-100 text-emerald-700 font-bold px-1.5 py-0.5 rounded uppercase">Material</span>}
                                        </div>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3 text-slate-500 text-xs italic">{item.category || "-"}</td>
                                    <td className="px-4 py-3 text-center font-bold text-green-700">{item.qty}</td>
                                    <td className="px-4 py-3 text-center">
                                      <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-green-100 text-green-700 px-3 py-1 rounded-full uppercase tracking-tighter">
                                        Matched
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="py-20 text-center bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
                        <p className="text-sm text-slate-500">No perfectly matched items found yet.</p>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}