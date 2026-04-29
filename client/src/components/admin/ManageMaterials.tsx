import { useState, useEffect, useRef } from "react";
import { Layout } from "@/components/layout/Layout";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useData } from "@/lib/store";
import {
  Package,
  Plus,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { postJSON } from "@/lib/api";

interface MaterialTemplate {
  id: string;
  name: string;
  code: string;
  category?: string;
  subcategory?: string;
  vendor_category?: string;
  created_at: string;
  image?: string;
}

interface Shop {
  id: string;
  name: string;
  vendorCategory?: string;
}

const UNIT_OPTIONS = [
  "pcs", "kg", "meter", "sqft", "cum", "litre", "set", "nos",
  "Meters", "Square feet", "Numbers", "Square Meter", "Bags", "Running feet", "Running meter",
  "LS", "BOX", "LTR", "CQM", "cft", "ml", "DOZ", "PKT", "Man labour", "Points",
  "Roll", "Days", "Inches", "Hours", "Percentage", "Length", "Panel", "Drum", "Ft", "1 Pkt",
  "Job", "Units"
];
const Required = () => <span className="text-red-500 ml-1">*</span>;

export default function ManageMaterials() {
  const { toast } = useToast();
  const { user } = useData();

  const [templates, setTemplates] = useState<MaterialTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [templatesSearch, setTemplatesSearch] = useState("");
  const [selectedVendorCategory, setSelectedVendorCategory] = useState("all-categories");
  const [vendorCategories, setVendorCategories] = useState<string[]>([]);

  const [categories, setCategories] = useState<string[]>([]);
  const [subcategories, setSubcategories] = useState<string[]>([]);
  const [products, setProducts] = useState<any[]>([]);

  const [selectedTemplate, setSelectedTemplate] = useState<MaterialTemplate | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [selectedShop, setSelectedShop] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const [entriesList, setEntriesList] = useState<any[]>([]);

  const [rateMessage, setRateMessage] = useState<{
    type: "success" | "info" | "none";
    text: string;
  }>({ type: "none", text: "" });
  const [loadingRate, setLoadingRate] = useState(false);
  const [intendedSubcategory, setIntendedSubcategory] = useState<string | null>(null);
  const [rateDate, setRateDate] = useState<string | null>(null);

  // Edit entry state
  const [editingEntryIndex, setEditingEntryIndex] = useState<number | null>(null);

  const [formData, setFormData] = useState({
    rate: "",
    unit: "",
    brandname: "",
    modelnumber: "",
    category: "",
    subcategory: "",
    product: "",
    technicalspecification: "",
    dimensions: "",
    finishtype: "",
    materialtype: "",
  });

  useEffect(() => {
    loadMaterialTemplates();
    loadShops();
    loadCategories();
    loadProducts();
  }, []);

  // Load vendor categories after templates are loaded
  useEffect(() => {
    if (templates.length > 0) {
      loadVendorCategories();
    }
  }, [templates]);

  const handleCloneMasterMaterial = async (template: any) => {
    const newName = `${template.name} (Copy)`;
    const newCode = template.name.substring(0, 3).toUpperCase() + "-" + Math.floor(1000 + Math.random() * 9000);

    try {
      const res = await postJSON(`/api/material-templates/clone/${template.id}`, {
        name: newName,
        code: newCode
      });

      const cloned = res.template || res;
      setTemplates((prev: any[]) => [cloned, ...prev]);

      toast({
        title: "Deep Clone Successful",
        description: `"${template.name}" and all its associated materials/rates have been cloned to "${newName}".`,
      });
    } catch (err: any) {
      console.error('clone master material error', err);
      toast({
        title: "Clone Failed",
        description: err?.message || 'Failed to deep clone material',
        variant: "destructive",
      });
    }
  };

  const loadMaterialTemplates = async () => {
    try {
      const token = localStorage.getItem("authToken");
      const response = await fetch("/api/material-templates", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await response.json();
      setTemplates(data.templates || []);
    } catch (error) {
      console.error("Error loading templates:", error);
      toast({
        title: "Error",
        description: "Failed to load material templates",
        variant: "destructive",
      });
    } finally {
      setLoadingTemplates(false);
    }
  };

  const loadShops = async () => {
    try {
      const response = await fetch("/api/shops");
      const data = await response.json();
      setShops(data.shops || []);
    } catch (error) {
      console.error("Error loading shops:", error);
    }
  };

  const loadCategories = async () => {
    try {
      const response = await fetch("/api/material-categories");
      const data = await response.json();
      setCategories(data.categories || []);
    } catch (error) {
      console.error("Error loading categories:", error);
    }
  };

  const loadSubcategories = async (category: string) => {
    if (!category) {
      setSubcategories([]);
      return;
    }

    try {
      const token = localStorage.getItem("authToken");
      const response = await fetch(
        `/api/material-subcategories/${encodeURIComponent(category)}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }
      );
      if (response.ok) {
        const data = await response.json();
        const loadedSubs = data.subcategories || [];
        setSubcategories(loadedSubs);

        // If we had an intended subcategory, check if it's in the loaded list (case-insensitive)
        if (intendedSubcategory) {
          const match = loadedSubs.find((s: string) => s.toLowerCase() === intendedSubcategory.toLowerCase());
          if (match) {
            setFormData(prev => ({ ...prev, subcategory: match }));
          }
          setIntendedSubcategory(null);
        }
      }
    } catch (err) {
      console.error("Error loading subcategories:", err);
    }
  };

  const loadProducts = async () => {
    try {
      const response = await fetch("/api/products");
      const data = await response.json();
      setProducts(data.products || []);
    } catch (error) {
      console.error("Error loading products:", error);
      setProducts([]);
    }
  };

  const loadVendorCategories = async () => {
    try {
      // Get vendor categories from templates, not from shops
      const categories = Array.from(
        new Set(templates.map(t => t.vendor_category).filter(Boolean))
      ) as string[];
      setVendorCategories(categories);
    } catch (error) {
      console.error("Error loading vendor categories:", error);
      setVendorCategories([]);
    }
  };

  const handleSelectTemplate = (template: MaterialTemplate) => {
    setSelectedTemplate(template);
    const rawCategory = template.category || (template as any).category_name || (template as any).Category || (template as any).categoryName || (template as any).vendor_category || "";
    const rawSubcategory = template.subcategory || (template as any).subCategory || (template as any).subcategory_name || (template as any).Subcategory || (template as any).subcategoryName || "";

    // Normalize category match from master list
    const matchedCategory = categories.find(c => c.toLowerCase() === rawCategory.toLowerCase()) || rawCategory;

    setFormData({
      rate: "",
      unit: (template as any).unit || "",
      brandname: (template as any).brandname || (template as any).brandName || "",
      modelnumber: (template as any).modelnumber || (template as any).modelNumber || "",
      category: matchedCategory,
      subcategory: rawSubcategory,
      product: "",
      technicalspecification: (template as any).technicalspecification || (template as any).technicalSpecification || "",
      dimensions: (template as any).dimensions || (template as any).Dimensions || "",
      finishtype: (template as any).finishtype || (template as any).finishType || "",
      materialtype: (template as any).metaltype || (template as any).metalType || (template as any).materialtype || (template as any).materialType || "",
    });

    if (rawSubcategory) {
      setIntendedSubcategory(rawSubcategory);
    }
    // Always reset shop and date when switching templates so stale data doesn't carry over
    setSelectedShop("");
    setRateDate(null);

    if (matchedCategory) {
      loadSubcategories(matchedCategory);
    }

    setTimeout(() => {
      const formElement = document.getElementById("material-form");
      if (formElement) {
        formElement.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 100);

    // Actively probe each known shop for a saved rate for this template and choose the one with the lowest rate.
    if (shops && shops.length > 0) {
      (async () => {
        try {
          const checks = await Promise.all(
            shops.map(async (sh) => {
              try {
                const resp = await fetch(
                  `/api/material-rate?template_id=${encodeURIComponent(template.id)}&shop_id=${encodeURIComponent(sh.id)}`
                );
                if (!resp.ok) return null;
                const data = await resp.json();
                if (data.found && data.material) {
                  const r = Number(data.material.rate ?? data.material.supply_rate ?? data.material.default_rate ?? 0) || 0;
                  return { shop_id: sh.id, rate: r, material: data.material, source: data.source };
                }
                return null;
              } catch (e) {
                return null;
              }
            })
          );

          let found = checks.filter(Boolean) as Array<any>;

          // Also include any approved materials and pending submissions globally
          try {
            const matsResp = await fetch('/api/materials');
            const mats = matsResp.ok ? (await matsResp.json()).materials || [] : [];
            for (const m of mats) {
              if (String(m.template_id) === String(template.id) && m.shop_id) {
                const r = Number(m.rate ?? m.supply_rate ?? m.default_rate ?? 0) || 0;
                found.push({ shop_id: String(m.shop_id), rate: r, material: m, source: 'approved' });
              }
            }
          } catch (e) {
            // ignore
          }

          try {
            const subsResp = await fetch('/api/material-submissions');
            const subs = subsResp.ok ? (await subsResp.json()).submissions || [] : [];
            for (const s of subs) {
              if (String(s.template_id) === String(template.id) && s.shop_id) {
                const r = Number(s.rate ?? 0) || 0;
                found.push({ shop_id: String(s.shop_id), rate: r, material: s, source: 'pending' });
              }
            }
          } catch (e) {
            // ignore
          }

          if (found.length === 0) return;

          found.sort((a, b) => a.rate - b.rate);
          const best = found[0];
          // Select the cheapest shop; this will trigger the existing useEffect to fetch
          // and prefill rate. Also prefill immediately for snappier UX.
          setSelectedShop(best.shop_id);
          setFormData((prev) => {
            const rawCat = best.material.category || (best.material as any).category_name || (best.material as any).Category || (best.material as any).categoryName || prev.category || "";
            const rawSub = best.material.subcategory || (best.material as any).subCategory || (best.material as any).subcategory_name || (best.material as any).Subcategory || (best.material as any).subcategoryName || prev.subcategory || "";

            const matchedCat = categories.find(c => c.toLowerCase() === rawCat.toLowerCase()) || rawCat;
            if (rawSub) setIntendedSubcategory(rawSub);

            return {
              ...prev,
              rate: best.material.rate != null ? String(best.material.rate) : prev.rate || "",
              unit: best.material.unit || prev.unit || "",
              brandname: best.material.brandname || prev.brandname || "",
              modelnumber: best.material.modelnumber || (best.material as any).modelNumber || prev.modelnumber || "",
              category: matchedCat,
              subcategory: rawSub,
              product: best.material.product || prev.product || "",
              technicalspecification: best.material.technicalspecification || (best.material as any).technicalSpecification || prev.technicalspecification || "",
              dimensions: best.material.dimensions || (best.material as any).Dimensions || prev.dimensions || "",
              finishtype: best.material.finishtype || (best.material as any).finishType || prev.finishtype || "",
              materialtype: best.material.materialtype || best.material.metaltype || (best.material as any).metalType || (best.material as any).materialType || prev.materialtype || "",
            };
          });
          setRateMessage({ type: "success", text: `✓ Existing Rate Loaded (${best.source === "approved" ? "Approved" : "Pending"})` });
          setRateDate(best.material.created_at || best.material.submitted_at || null);
          if (best.material.category) await loadSubcategories(best.material.category);
        } catch (err) {
          console.warn('[ManageMaterials] Failed to auto-select cheapest shop', err);
        }
      })();
    }
  };

  // When both shop and template are selected, automatically fetch the existing rate
  useEffect(() => {
    const fetchRate = async () => {
      if (!selectedTemplate || !selectedShop) {
        setRateMessage({ type: "none", text: "" });
        return;
      }

      setLoadingRate(true);
      try {
        const response = await fetch(
          `/api/material-rate?template_id=${encodeURIComponent(selectedTemplate.id)}&shop_id=${encodeURIComponent(selectedShop)}`
        );

        if (!response.ok) {
          console.warn('[ManageMaterials] Failed to fetch material rate');
          setRateMessage({ type: "none", text: "" });
          setLoadingRate(false);
          return;
        }

        const data = await response.json();
        console.log('[ManageMaterials] Rate fetch result:', data);

        if (data.found && data.material) {
          // Prefill form fields with the existing material's values
          setFormData((prev) => {
            const rawCat = data.material.category || (data.material as any).category_name || (data.material as any).Category || (data.material as any).categoryName || prev.category || "";
            const rawSub = data.material.subcategory || (data.material as any).subCategory || (data.material as any).subcategory_name || (data.material as any).Subcategory || (data.material as any).subcategoryName || prev.subcategory || "";

            const matchedCat = categories.find(c => c.toLowerCase() === rawCat.toLowerCase()) || rawCat;
            if (rawSub) setIntendedSubcategory(rawSub);

            return {
              ...prev,
              rate: data.material.rate != null ? String(data.material.rate) : "",
              unit: data.material.unit || prev.unit || "",
              brandname: data.material.brandname || prev.brandname || "",
              modelnumber: data.material.modelnumber || (data.material as any).modelNumber || prev.modelnumber || "",
              category: matchedCat,
              subcategory: rawSub,
              product: data.material.product || prev.product || "",
              technicalspecification: data.material.technicalspecification || (data.material as any).technicalSpecification || prev.technicalspecification || "",
              dimensions: data.material.dimensions || (data.material as any).Dimensions || prev.dimensions || "",
              finishtype: data.material.finishtype || (data.material as any).finishType || prev.finishtype || "",
              materialtype: data.material.materialtype || data.material.metaltype || (data.material as any).metalType || (data.material as any).materialType || prev.materialtype || "",
            };
          });
          setRateDate(data.material.created_at || null);

          // Load subcategories if category is present
          if (data.material.category) {
            await loadSubcategories(data.material.category);
          }

          // Show success message
          setRateMessage({
            type: "success",
            text: `✓ Existing Rate Loaded (${data.source === "approved" ? "Approved" : "Pending"})`,
          });
        } else {
          // No rate found: clear rate field but keep other template-specific data
          setRateDate(null);
          setFormData((prev) => ({
            ...prev,
            rate: "",
            // Don't clear unit/brand/etc. if they already have values from template
          }));

          setRateMessage({
            type: "info",
            text: "No rate found for this shop - enter a new rate",
          });
        }
      } catch (err) {
        console.warn('[ManageMaterials] Rate fetch error:', err);
        setRateMessage({ type: "none", text: "" });
      } finally {
        setLoadingRate(false);
      }
    };

    fetchRate();
  }, [selectedShop, selectedTemplate]);

  const handleSubmitMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;

    if (!selectedTemplate || !selectedShop) {
      toast({
        title: "Error",
        description: "Please select a template and shop",
        variant: "destructive",
      });
      return;
    }

    let toSubmit: any[] = [];

    if (entriesList.length > 0) {
      const confirmSubmit = window.confirm(
        `Are you sure you want to submit ${entriesList.length} items for approval?`
      );
      if (!confirmSubmit) return;
      toSubmit = entriesList;
    } else {
      if (!formData.rate || !formData.unit) {
        toast({
          title: "Error",
          description: "Rate and unit are required",
          variant: "destructive",
        });
        return;
      }
      toSubmit = [
        {
          template_id: selectedTemplate.id,
          shop_id: selectedShop,
          ...formData,
        },
      ];
    }

    setSubmitting(true);
    submittingRef.current = true;
    try {
      const token = localStorage.getItem("authToken");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      for (const payload of toSubmit) {
        const response = await fetch("/api/material-submissions", {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error("Failed to submit material");
      }

      toast({
        title: "Success",
        description: `${toSubmit.length} material(s) submitted for approval`,
      });

      setSelectedTemplate(null);
      setEntriesList([]);
      setFormData({
        rate: "",
        unit: "",
        brandname: "",
        modelnumber: "",
        category: "",
        subcategory: "",
        product: "",
        technicalspecification: "",
        dimensions: "",
        finishtype: "",
        materialtype: "",
      });
    } catch {
      toast({
        title: "Error",
        description: "Failed to submit material",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
      submittingRef.current = false;
    }
  };

  const handleAddEntry = () => {
    if (!selectedTemplate || !selectedShop) {
      toast({
        title: "Error",
        description: "Please select a template and shop",
        variant: "destructive",
      });
      return;
    }

    if (!formData.rate || !formData.unit) {
      toast({
        title: "Error",
        description: "Rate and unit are required",
        variant: "destructive",
      });
      return;
    }

    const entry = {
      template_id: selectedTemplate.id,
      shop_id: selectedShop,
      ...formData,
    };

    setEntriesList((s) => [...s, entry]);

    setFormData((prev) => ({
      ...prev,
      rate: "",
      unit: "",
      brandname: "",
      modelnumber: "",
      subcategory: "",
      product: "",
      technicalspecification: "",
      dimensions: "",
      finishtype: "",
      materialtype: "",
    }));

    toast({
      title: "Entry Added",
      description: "Item added to the submission list.",
    });
  };

  const handleRemoveEntry = (index: number) => {
    setEntriesList((s) => s.filter((_, i) => i !== index));
  };

  const handleEditEntry = (index: number) => {
    const entry = entriesList[index];
    setEditingEntryIndex(index);

    // Set the shop for this entry
    setSelectedShop(entry.shop_id || "");

    // Populate form with entry data
    setFormData({
      rate: entry.rate || "",
      unit: entry.unit || "",
      brandname: entry.brandname || "",
      modelnumber: entry.modelnumber || "",
      category: entry.category || "",
      subcategory: entry.subcategory || "",
      product: entry.product || "",
      technicalspecification: entry.technicalspecification || "",
      dimensions: entry.dimensions || "",
      finishtype: entry.finishtype || "",
      materialtype: entry.materialtype || entry.metaltype || "",
    });

    // Load subcategories if category exists
    if (entry.category) {
      loadSubcategories(entry.category);
    }

    // Scroll to form
    setTimeout(() => {
      const formElement = document.getElementById("material-form");
      if (formElement) {
        formElement.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 100);
  };

  const handleUpdateEntry = () => {
    if (editingEntryIndex === null) return;

    if (!formData.rate || !formData.unit) {
      toast({
        title: "Error",
        description: "Rate and unit are required",
        variant: "destructive",
      });
      return;
    }

    const updatedEntry = {
      template_id: selectedTemplate?.id || entriesList[editingEntryIndex].template_id,
      shop_id: selectedShop || entriesList[editingEntryIndex].shop_id,
      ...formData,
    };

    setEntriesList((prev) =>
      prev.map((entry, index) =>
        index === editingEntryIndex ? updatedEntry : entry
      )
    );

    // Clear form and editing state
    setFormData({
      rate: "",
      unit: "",
      brandname: "",
      modelnumber: "",
      category: selectedTemplate?.category || "",
      subcategory: (selectedTemplate as any)?.subcategory || (selectedTemplate as any)?.subCategory || "",
      product: "",
      technicalspecification: (selectedTemplate as any)?.technicalspecification || "",
      dimensions: "",
      finishtype: "",
      materialtype: "",
    });
    setEditingEntryIndex(null);

    toast({
      title: "Entry Updated",
      description: "Item updated in the submission list.",
    });
  };

  const handleCancelEdit = () => {
    setEditingEntryIndex(null);
    setSelectedShop(""); // Reset shop selection
    setFormData({
      rate: "",
      unit: "",
      brandname: "",
      modelnumber: "",
      category: selectedTemplate?.category || "",
      subcategory: (selectedTemplate as any)?.subcategory || (selectedTemplate as any)?.subCategory || "",
      product: "",
      technicalspecification: (selectedTemplate as any)?.technicalspecification || "",
      dimensions: "",
      finishtype: "",
      materialtype: "",
    });
  };

  return (
    <Layout>
      <div className="container mx-auto py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Material Management</h1>
          <p className="text-gray-600">Select from available material templates and add your details</p>
        </div>

        <div className="grid gap-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Package className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-xl font-semibold">Available Material Templates</h2>
            </div>

            {/* Search Filter Options */}
            <div className="space-y-3 mb-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm mb-2 block">Search Templates</Label>
                  <Input
                    value={templatesSearch}
                    onChange={(e) => setTemplatesSearch(e.target.value)}
                    placeholder="Search by name or code..."
                  />
                </div>
                <div>
                  <Label className="text-sm mb-2 block">Filter by Vendor Category</Label>
                  <Select value={selectedVendorCategory} onValueChange={setSelectedVendorCategory}>
                    <SelectTrigger>
                      <SelectValue placeholder="All categories" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72 overflow-y-auto">
                      <SelectItem value="all-categories">All Categories</SelectItem>
                      {vendorCategories.map((vc) => (
                        <SelectItem key={vc} value={vc}>{vc}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {loadingTemplates ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : (
              <div className="space-y-2">
                {templates
                  .filter((t) => {
                    const hay = (t.name + " " + t.code + " " + (t.category || "")).toLowerCase();
                    const matchesSearch = hay.includes(templatesSearch.toLowerCase());
                    const vendorField = t.vendor_category || "";
                    const matchesVendor = selectedVendorCategory === "all-categories" ? true : vendorField === selectedVendorCategory;
                    return matchesSearch && matchesVendor;
                  })
                  .slice(0, 12)
                  .map((template) => (
                    <div key={template.id} className="p-2 border-b bg-white hover:bg-slate-50 transition-colors">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 flex items-center gap-3">
                          <div className="font-medium text-sm">{template.name}</div>
                        </div>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="h-7" onClick={() => handleSelectTemplate(template)}>Select</Button>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">{template.code} {template.category && <span className="ml-2">• {template.category}</span>}</div>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {selectedTemplate && (
            <Card id="material-form" className="scroll-mt-20 border-blue-200 shadow-sm">
              <CardHeader className="py-3 bg-blue-50/50">
                <CardTitle className="text-base">
                  {editingEntryIndex !== null ? "Edit Material Details" : "Submit Material Details"}
                </CardTitle>
                <CardDescription className="text-xs mt-1">
                  {editingEntryIndex !== null
                    ? `Editing item ${editingEntryIndex + 1} from submission queue`
                    : `Editing: ${selectedTemplate.name} (${selectedTemplate.code})`
                  }
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                <form onSubmit={handleSubmitMaterial} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <Label>Shop <Required /></Label>
                      <Select value={selectedShop} onValueChange={setSelectedShop}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a shop" />
                        </SelectTrigger>
                        <SelectContent className="max-h-72 overflow-y-auto">
                          {[...shops].sort((a, b) => a.name.localeCompare(b.name)).map((shop) => (
                            <SelectItem key={shop.id} value={shop.id}>{shop.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Rate <Required /></Label>
                      <div className="flex gap-2 items-center">
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          value={formData.rate}
                          onChange={(e) => setFormData({ ...formData, rate: e.target.value })}
                          disabled={loadingRate}
                        />
                        {loadingRate && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                      </div>
                      {rateMessage.type === "success" && (
                        <p className="text-sm text-green-600 mt-1 font-medium">{rateMessage.text}</p>
                      )}
                      {rateMessage.type === "info" && (
                        <p className="text-sm text-amber-600 mt-1">{rateMessage.text}</p>
                      )}
                      {rateDate && (() => {
                        const daysOld = Math.floor((Date.now() - new Date(rateDate).getTime()) / (1000 * 60 * 60 * 24));
                        return (
                          <p className={`text-xs mt-1 font-medium ${daysOld > 90 ? "text-amber-600" : "text-slate-500"}`}>
                            {daysOld > 90 ? "⚠️" : "🗓️"} Price added on {new Date(rateDate).toLocaleDateString()} ({daysOld} day{daysOld !== 1 ? "s" : ""} ago){daysOld > 90 ? " — Reconfirm with vendor" : ""}
                          </p>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <Label>Unit <Required /></Label>
                      <Select value={formData.unit} onValueChange={(v) => setFormData({ ...formData, unit: v })}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select unit" />
                        </SelectTrigger>
                        <SelectContent className="max-h-72 overflow-y-auto">
                          {UNIT_OPTIONS.map((unit) => (
                            <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Brand Name</Label>
                      <Input
                        placeholder="Enter brand"
                        value={formData.brandname}
                        onChange={(e) => setFormData({ ...formData, brandname: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <Label>Model Number</Label>
                      <Input
                        placeholder="Enter model"
                        value={formData.modelnumber}
                        onChange={(e) => setFormData({ ...formData, modelnumber: e.target.value })}
                      />
                    </div>

                    <div>
                      <Label>Category</Label>
                      <Select value={formData.category} onValueChange={(v) => {
                        setFormData({ ...formData, category: v, subcategory: "" });
                        loadSubcategories(v);
                      }}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                        <SelectContent className="max-h-72 overflow-y-auto">
                          {categories.map((cat) => (
                            <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <Label>Subcategory</Label>
                      <Select value={formData.subcategory} onValueChange={(v) => setFormData({ ...formData, subcategory: v, product: "" })} disabled={!formData.category || subcategories.length === 0}>
                        <SelectTrigger>
                          <SelectValue placeholder={subcategories.length === 0 ? "No subcategories" : "Select subcategory"} />
                        </SelectTrigger>
                        <SelectContent className="max-h-72 overflow-y-auto">
                          {subcategories.map((subcat) => (
                            <SelectItem key={subcat} value={subcat}>{subcat}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Product</Label>
                      <Select value={formData.product} onValueChange={(v) => setFormData({ ...formData, product: v })} disabled={!formData.subcategory || products.length === 0}>
                        <SelectTrigger>
                          <SelectValue placeholder={products.length === 0 ? "No products" : "Select product"} />
                        </SelectTrigger>
                        <SelectContent>
                          {products
                            .filter((p: any) =>
                              (p.subcategory || p.subcategory_name || "").toLowerCase().trim() === (formData.subcategory || "").toLowerCase().trim()
                            )
                            .map((p: any) => (
                              <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label>Technical Specification</Label>
                    <Textarea
                      placeholder="Material technical details..."
                      value={formData.technicalspecification}
                      onChange={(e) => setFormData({ ...formData, technicalspecification: e.target.value })}
                      rows={3}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <Label>Dimensions</Label>
                      <Input placeholder="L x W x H" value={formData.dimensions} onChange={(e) => setFormData({ ...formData, dimensions: e.target.value })} />
                    </div>
                    <div>
                      <Label>Finish</Label>
                      <Input placeholder="Matte/Glossy" value={formData.finishtype} onChange={(e) => setFormData({ ...formData, finishtype: e.target.value })} />
                    </div>
                    <div>
                      <Label>Material</Label>
                      <Input placeholder="Material Type" value={formData.materialtype} onChange={(e) => setFormData({ ...formData, materialtype: e.target.value })} />
                    </div>
                  </div>

                  {entriesList.length > 0 && (
                    <div className="mt-6 border rounded-lg overflow-hidden">
                      <div className="bg-slate-100 px-4 py-2 text-sm font-semibold flex justify-between items-center">
                        <span>Items in Submission Queue ({entriesList.length})</span>
                        <AlertTriangle className="w-4 h-4 text-amber-600" />
                      </div>
                      <div className="max-h-48 overflow-y-auto divide-y">
                        {entriesList.map((entry, idx) => (
                          <div key={idx} className="flex items-center justify-between px-4 py-3 bg-white">
                            <div className="text-xs flex-1">
                              <div className="font-bold text-slate-700">Rate: {entry.rate} / {entry.unit}</div>
                              <div className="text-slate-500">
                                {entry.brandname || 'No Brand'} • {entry.category}
                                {entry.subcategory && ` • ${entry.subcategory}`}
                                {entry.product && ` • ${entry.product}`}
                              </div>
                              {entry.technicalspecification && (
                                <div className="text-slate-400 mt-1 truncate max-w-xs">
                                  {entry.technicalspecification}
                                </div>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 text-blue-600 hover:bg-blue-50"
                                onClick={() => handleEditEntry(idx)}
                                disabled={editingEntryIndex !== null}
                              >
                                Edit
                              </Button>
                              <Button type="button" size="sm" variant="ghost" className="text-red-500 h-8 hover:bg-red-50" onClick={() => handleRemoveEntry(idx)}>
                                Remove
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t">
                    {editingEntryIndex !== null ? (
                      <>
                        <Button type="button" onClick={handleUpdateEntry} className="flex-1 gap-2 bg-green-600 hover:bg-green-700">
                          Update Entry
                        </Button>
                        <Button type="button" onClick={handleCancelEdit} variant="outline" className="flex-1">
                          Cancel Edit
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button type="button" onClick={handleAddEntry} variant="outline" className="flex-1 gap-2 border-blue-200 text-blue-700 hover:bg-blue-50">
                          <Plus className="w-4 h-4" /> Add to List
                        </Button>
                        <Button type="submit" disabled={submitting} className="flex-1 gap-2 bg-blue-600 hover:bg-blue-700">
                          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                          {entriesList.length > 0 ? `Submit ${entriesList.length} Items` : "Submit Single Item"}
                        </Button>
                      </>
                    )}
                    <Button type="button" variant="ghost" onClick={() => {
                      setSelectedTemplate(null);
                      setEditingEntryIndex(null);
                      setSelectedShop("");
                      setFormData({
                        rate: "",
                        unit: "",
                        brandname: "",
                        modelnumber: "",
                        category: "",
                        subcategory: "",
                        product: "",
                        technicalspecification: "",
                        dimensions: "",
                        finishtype: "",
                        materialtype: "",
                      });
                    }}>Cancel</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </Layout>
  );
}