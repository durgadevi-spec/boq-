import { useState, useEffect } from "react";
import { SupplierLayout } from "@/components/layout/SupplierLayout";
import SupplierMaterials from "./SupplierMaterials";

interface Shop {
  id: string;
  name: string;
  location?: string;
  approved?: boolean;
}

export function SupplierMaterialsPage() {
  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPrimaryShop();
  }, []);

  const loadPrimaryShop = async () => {
    try {
      const token = localStorage.getItem("authToken");
      const response = await fetch("/api/supplier/my-shops", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        setLoading(false);
        return;
      }

      const data = await response.json();
      const shops = data.shops || [];
      
      // Get the first approved shop, or the first shop
      const primaryShop = shops.find((s: Shop) => s.approved === true) || shops[0];
      setShop(primaryShop);
    } catch (error) {
      console.error("Error loading shop:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <SupplierLayout>
        <div className="p-6 text-center">
          <p className="text-gray-600">Loading...</p>
        </div>
      </SupplierLayout>
    );
  }

  return <SupplierMaterials />;
}
