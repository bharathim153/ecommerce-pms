"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ProductForm } from "@/components/admin/ProductForm";
import { Spinner } from "@/components/ui";
import { api, parseError, type ApiEnvelope } from "@/lib/api";
import type { Product } from "@/types";

export function EditProduct() {
  const { id } = useParams<{ id: string }>();
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<ApiEnvelope<Product>>(`/admin/products/${id}`)
      .then((r) => setProduct(r.data.data))
      .catch((err) => setError(parseError(err).status === 404 ? "Product not found." : parseError(err).message));
  }, [id]);

  if (error) return <p className="text-red-700">{error}</p>;
  if (!product) return <Spinner label="Loading product" />;
  return <ProductForm key={product.id} product={product} />;
}
