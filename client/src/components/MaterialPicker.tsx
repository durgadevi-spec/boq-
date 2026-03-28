import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import apiFetch from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { fuzzySearch } from "@/lib/utils";

type Material = {
  id: string;
  name: string;
  code: string;
  image?: string;
  category?: string;
  subcategory?: string;
  vendor_category?: string;
  tax_code_type?: string;
  tax_code_value?: string;
  shop_name?: string;
  unit?: string;
  hsn_code?: string;
  sac_code?: string;
  rate?: number;
  created_at: string;
  updated_at: string;
};

const parseImages = (imageField: string | null | undefined): string[] => {
  if (!imageField) return [];
  try {
    if (imageField.startsWith('[')) return JSON.parse(imageField);
    return [imageField];
  } catch (e) {
    return [imageField];
  }
};

type MaterialPickerProps = {
  onSelectTemplate: (material: Material) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function MaterialPicker({
  onSelectTemplate,
  open,
  onOpenChange,
}: MaterialPickerProps) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [filteredMaterials, setFilteredMaterials] = useState<Material[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  // Load all materials on mount
  useEffect(() => {
    const loadMaterials = async () => {
      try {
        const response = await apiFetch("/api/materials", {
          headers: {},
        });
        if (response.ok) {
          const data = await response.json();
          const materialList = data.materials || [];
          setMaterials(materialList);
          setFilteredMaterials(materialList);
        } else {
          toast({
            title: "Error",
            description: "Failed to load materials",
            variant: "destructive",
          });
        }
      } catch (err) {
        console.error("Failed to load materials:", err);
        toast({
          title: "Error",
          description: "Failed to load materials",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    if (open) {
      loadMaterials();
    }
  }, [open, toast]);

  // Filter materials based on search query
  useEffect(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      setFilteredMaterials(materials);
      return;
    }

    const filtered = materials
      .map((material) => {
        const name = (material.name || "").toLowerCase();
        const code = (material.code || "").toLowerCase();

        // Use fuzzySearch from utils to handle multi-word, synonyms, and partial matching
        // Restrict to only name and code per user request (no categories, shop names, etc)
        const isMatch = fuzzySearch(query, [
          name,
          code,
        ]);

        if (!isMatch) return null;

        // Calculate score for ranking
        let score = 0;
        
        // Exact name match or contains full query in name (high priority)
        if (name.includes(query)) score += 100;
          
        // Any word from query in name
        const queryWords = query.split(/\s+/).filter(Boolean);
        if (queryWords.some(word => name.includes(word))) score += 50;

        // Match in code
        if (code.includes(query)) score += 30;

        return { material, score };
      })
      .filter((item): item is { material: Material; score: number } => item !== null)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.material);

    setFilteredMaterials(filtered);
  }, [searchQuery, materials]);

  const handleMaterialSelect = (material: Material) => {
    onSelectTemplate(material);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Select Material</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Choose a material from a shop to add to your BOQ
          </p>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="material-search">Search Materials</Label>
            <Input
              id="material-search"
              placeholder="Search by name, code, shop, category..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="mt-2"
            />
          </div>

          {loading ? (
            <div className="text-center py-8 text-muted-foreground flex flex-col items-center gap-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
              <span>Loading materials...</span>
            </div>
          ) : filteredMaterials.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              {materials.length === 0
                ? "No materials available"
                : "No materials match your search"}
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
              {filteredMaterials.map((material) => (
                <Button
                  key={material.id}
                  variant="outline"
                  onClick={() => handleMaterialSelect(material)}
                  className="w-full justify-start h-auto py-3 px-4 hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
                >
                  <div className="flex items-center gap-4 w-full">
                    <div className="h-14 w-14 border rounded bg-gray-50 overflow-hidden flex items-center justify-center shrink-0">
                      {material.image ? (
                        <img
                          src={parseImages(material.image)[0]}
                          alt=""
                          className="max-w-full max-h-full object-contain"
                        />
                      ) : (
                        <div className="text-[10px] text-gray-400 font-bold uppercase text-center p-1">No Icon</div>
                      )}
                    </div>
                    <div className="text-left w-full flex-1">
                      <div className="flex justify-between items-start">
                        <div className="font-bold text-gray-900">{material.name}</div>
                        <div className="text-[10px] font-mono bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded ml-2 shrink-0">
                          {material.code}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                        {material.shop_name && (
                          <div className="text-xs font-semibold text-blue-700 flex items-center">
                            <span className="w-2 h-2 rounded-full bg-blue-500 mr-1.5"></span>
                            {material.shop_name}
                          </div>
                        )}
                        {material.category && (
                          <div className="text-[11px] text-gray-500">
                            {material.category} {material.subcategory && ` → ${material.subcategory}`}
                          </div>
                        )}
                        {material.hsn_code && (
                          <div className="text-[10px] bg-amber-50 text-amber-700 px-1 rounded">HSN: {material.hsn_code}</div>
                        )}
                        {material.sac_code && (
                          <div className="text-[10px] bg-blue-50 text-blue-700 px-1 rounded">SAC: {material.sac_code}</div>
                        )}
                      </div>

                      <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-100 italic">
                        <div className="text-[11px] text-gray-500">
                          {material.unit || "unit"}
                        </div>
                        <div className="font-extrabold text-green-700">
                          ₹{Number(material.rate || 0).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  </div>
                </Button>
              ))}
            </div>
          )}

          {filteredMaterials.length > 0 && (
            <div className="text-[10px] text-gray-400 text-center uppercase tracking-widest">
              Showing {filteredMaterials.length} of {materials.length} available materials
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
