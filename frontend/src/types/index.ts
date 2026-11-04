export type Role = "admin" | "customer";

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  mfa_enabled: boolean;
  email_verified: boolean;
  phone?: string | null;
}

export interface Category { id: number; name: string; slug: string; products_count?: number }

export interface ProductImage { id: number; url: string; alt: string | null; is_primary: boolean; sort_order: number }

export type ProductStatus = "draft" | "published" | "archived";

export interface Product {
  id: number;
  name: string;
  slug: string;
  sku: string;
  price: string;
  stock: number;
  status: ProductStatus;
  short_description: string | null;
  description?: string | null;
  category: Pick<Category, "id" | "name" | "slug"> | null;
  category_id: number | null;
  images?: ProductImage[];
  primary_image: string | null;
  created_at: string;
  updated_at: string;
}

export interface PageMeta { current_page: number; last_page: number; per_page: number; total: number }

export type ExportStatus = "queued" | "processing" | "completed" | "failed";

export interface PdfExport {
  id: number;
  scope: "selected" | "all";
  status: ExportStatus;
  progress: number;
  total_products: number;
  processed_products: number;
  page_count: number | null;
  size_bytes: number | null;
  error: string | null;
  user: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface OrderItem { id: number; product_id: number | null; name: string; sku: string; unit_price: string; quantity: number; line_total: string }
export type OrderStatus = "pending" | "paid" | "failed" | "cancelled" | "refunded";
export interface Order {
  id: number; number: string; status: OrderStatus; subtotal: string; total: string; currency: string;
  paid_at: string | null; created_at: string; items: OrderItem[];
  payments: { id: number; provider: string; status: string; amount: string; created_at: string }[];
  customer?: { name: string; email: string } | null;
  payment_note?: string | null;
}
export interface PaymentMethods { currency: string; stripe: boolean; paypal: boolean }

export interface EmailTemplate { id: number; name: string; subject: string; body_html: string; updated_at: string }
export interface Subscriber { id: number; email: string; name: string | null; is_subscribed: boolean; subscribed_at: string | null; unsubscribed_at: string | null; bounced_at: string | null; source: string }
export type CampaignStatus = "draft" | "sending" | "completed" | "failed" | "cancelled";
export interface CampaignCounts { queued: number; sent: number; delivered: number; failed: number; bounced: number; skipped: number }
export interface Campaign {
  id: number; subject: string; status: CampaignStatus; template_id: number | null; total_recipients: number; counts: CampaignCounts;
  created_by: string | null; started_at: string | null; finished_at: string | null; created_at: string; body_html?: string;
}
export interface CampaignLog { id: number; email: string | null; status: string; error: string | null; sent_at: string | null; delivered_at: string | null }

export interface DashboardData {
  days: number; currency: string; range: { from: string; to: string };
  totals: {
    products: { total: number; new: number; published: number };
    customers: { total: number; new: number };
    orders: { total: number; new: number; paid: number };
    revenue: { total: number; period: number };
  };
  series: { date: string; revenue: number; orders: number }[];
  orders_by_status: { status: string; count: number }[];
  payments: { provider: string; attempts: number; succeeded: number; failed: number; refunded: number; revenue: number }[];
  recent_orders: { id: number; number: string; status: OrderStatus; total: string; currency: string; customer: string | null; created_at: string }[];
  recent_customers: { id: number; name: string; email: string; verified: boolean; created_at: string }[];
  pdf_exports: { counts: Record<string, number>; recent: { id: number; scope: string; status: ExportStatus; progress: number; total_products: number; page_count: number | null; created_at: string }[] };
  campaigns: { subscribers: { subscribed: number; unsubscribed: number; bounced: number }; created: number; sent: number; delivered: number; failed: number; bounced: number; recent: { id: number; subject: string; status: CampaignStatus; total_recipients: number; sent: number; failed: number; created_at: string }[] };
}
