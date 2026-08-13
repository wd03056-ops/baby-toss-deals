export type Product = {
  tacaItemId: number;
  displayName: string;
  thumbnailUrl: string;
  productUrl: string;
  displayPrice: number;
  originalPrice: number;
  discountRate: number;
  isSoldOut: boolean;
  brandName?: string;
  endAt?: string;
  rank?: number;
  reviewScore?: number;
  reviewCount?: number;
  isFreeShipping?: boolean;
  shippingFee?: number;
  deliveryType?: string;
};
