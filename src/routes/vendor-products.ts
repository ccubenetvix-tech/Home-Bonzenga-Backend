import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { checkVendorApproved } from '../middleware/vendorApproval';

const router = Router();

// Get all products for a vendor
router.get('/:vendorId/products', authenticate, async (req, res) => {
  try {
    const { vendorId: userId } = req.params;
    console.log(`📥 GET /api/vendor/${userId}/products - Fetching products`);

    // Find the vendor record for this user
    const { data: vendor, error: vendorError } = await supabase
      .from('vendor')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (vendorError || !vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('*')
      .eq('vendor_id', vendor.id)
      .order('created_at', { ascending: false });

    if (productsError) throw productsError;

    console.log(`✅ Found ${products?.length || 0} products`);

    // Transform to camelCase
    const transformedProducts = (products || []).map((p: any) => ({
      ...p,
      vendorId: p.vendor_id,
      createdAt: p.created_at,
      totalSales: p.total_sales || 0,
      isActive: p.is_active
    }));

    res.json({ products: transformedProducts });
  } catch (error) {
    console.error('❌ Error fetching products:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Create new product
router.post('/:vendorId/products', authenticate, checkVendorApproved, async (req, res) => {
  try {
    const { vendorId: userId } = req.params;
    // Accept snake_case keys as well as fallback to camelCase if provided
    const {
      product_name, name,
      category_id, category,
      price_cdf, price,
      stock_quantity, stock,
      sku_code, sku,
      description
    } = req.body;

    console.log(`📥 POST /api/vendor/${userId}/products - Creating product`);

    // Normalize inputs
    const pName = product_name || name;
    const pCategory = category_id || category;
    const pPrice = price_cdf || price;
    const pStock = stock_quantity || stock;
    const pSku = sku_code || sku;

    // Find the vendor record for this user
    const { data: vendor, error: vendorError } = await supabase
      .from('vendor')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (vendorError || !vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    const { data: product, error: createError } = await supabase
      .from('products')
      .insert({
        vendor_id: vendor.id,
        // Use user-specified column names
        product_name: pName,
        category_id: pCategory,
        price_cdf: parseFloat(pPrice),
        stock_quantity: parseInt(pStock) || 0,
        sku_code: pSku || null,
        description: description || null,
        is_active: true,
        rating: 0,
        total_sales: 0
      })
      .select()
      .single();

    if (createError) throw createError;

    console.log(`✅ Product created: ${product.id}`);
    res.status(201).json({ product }); // Return raw Supabase object (snake_case)
  } catch (error) {
    console.error('❌ Error creating product:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update product
router.put('/:vendorId/products/:productId', authenticate, async (req, res) => {
  try {
    const { productId } = req.params;
    const {
      product_name, name,
      category_id, category,
      price_cdf, price,
      stock_quantity, stock,
      sku_code, sku,
      description,
      isActive
    } = req.body;

    console.log(`📥 PUT /api/vendor/.../products/${productId} - Updating product`);

    const pName = product_name || name;
    const pCategory = category_id || category;
    const pPrice = price_cdf || price;
    const pStock = stock_quantity || stock;
    const pSku = sku_code || sku;

    const updatePayload: any = {
      description: description || null,
      is_active: isActive !== undefined ? isActive : true
    };
    if (pName) updatePayload.product_name = pName;
    if (pCategory) updatePayload.category_id = pCategory;
    if (pPrice !== undefined) updatePayload.price_cdf = parseFloat(pPrice);
    if (pStock !== undefined) updatePayload.stock_quantity = parseInt(pStock);
    if (pSku !== undefined) updatePayload.sku_code = pSku;

    const { data: product, error: updateError } = await supabase
      .from('products')
      .update(updatePayload)
      .eq('id', productId)
      .select()
      .single();

    if (updateError) throw updateError;

    console.log(`✅ Product updated: ${product.id}`);
    res.json({ product });
  } catch (error) {
    console.error('❌ Error updating product:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Delete product
router.delete('/:vendorId/products/:productId', authenticate, async (req, res) => {
  try {
    const { productId } = req.params;
    console.log(`📥 DELETE /api/vendor/.../products/${productId} - Deleting product`);

    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', productId);

    if (error) throw error;

    console.log(`✅ Product deleted: ${productId}`);
    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('❌ Error deleting product:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Toggle product status
router.patch('/:vendorId/products/:productId/toggle', authenticate, async (req, res) => {
  try {
    const { productId } = req.params;
    console.log(`📥 PATCH /api/vendor/.../products/${productId}/toggle - Toggling product status`);

    const { data: product, error: fetchError } = await supabase
      .from('products')
      .select('is_active')
      .eq('id', productId)
      .single();

    if (fetchError || !product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const { data: updatedProduct, error: updateError } = await supabase
      .from('products')
      .update({ is_active: !product.is_active })
      .eq('id', productId)
      .select()
      .single();

    if (updateError) throw updateError;

    console.log(`✅ Product status toggled: ${updatedProduct.id} - ${updatedProduct.is_active ? 'Active' : 'Inactive'}`);

    // Transform to camelCase
    const transformedProduct = {
      ...updatedProduct,
      vendorId: updatedProduct.vendor_id,
      createdAt: updatedProduct.created_at,
      totalSales: updatedProduct.total_sales || 0,
      isActive: updatedProduct.is_active
    };

    res.json({ product: transformedProduct });
  } catch (error) {
    console.error('❌ Error toggling product status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get single product
router.get('/:vendorId/products/:productId', authenticate, async (req, res) => {
  try {
    const { productId } = req.params;
    console.log(`📥 GET /api/vendor/.../products/${productId} - Fetching product`);

    const { data: product, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', productId)
      .single();

    if (error || !product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    console.log(`✅ Product found: ${product.id}`);

    // Transform to camelCase
    const transformedProduct = {
      ...product,
      vendorId: product.vendor_id,
      createdAt: product.created_at,
      totalSales: product.total_sales || 0,
      isActive: product.is_active
    };

    res.json({ product: transformedProduct });
  } catch (error) {
    console.error('❌ Error fetching product:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
