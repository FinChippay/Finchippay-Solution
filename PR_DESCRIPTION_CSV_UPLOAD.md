## PR Title
feat(batch-payments): Add drag-and-drop CSV upload for batch payment recipients

## PR Description

### Summary
This PR implements a comprehensive drag-and-drop CSV file upload feature for batch payments, allowing users to efficiently import recipient lists from CSV files. The implementation includes column mapping, validation preview with inline editing, and error reporting.

### Problem
Batch payments with more than 5-10 recipients are too tedious to enter manually. Users with payroll CSV exports or accounting system exports need a fast import path for bulk payment processing.

### Solution
Added a new `CSVUpload` component with the following capabilities:

#### Features Implemented
1. **Drag-and-Drop Upload Zone**: Users can drag CSV files directly onto the upload zone or use the file picker
2. **CSV Parsing**: Client-side parsing using PapaParse library
3. **Column Mapping**: Interactive UI allowing users to map CSV columns to payment fields (recipient address, amount, asset, memo)
4. **Validation Preview**: 
   - Displays all parsed rows with visual status indicators (green for valid, red for invalid)
   - Shows specific error messages for each invalid row
   - Supports inline editing to fix errors before importing
5. **Smart Import**: "Import All Valid" button adds only valid rows to the batch payment list
6. **CSV Template Download**: Users can download a template CSV file with correct column headers

#### Technical Details
- **New Component**: `frontend/components/CSVUpload.tsx` - Standalone CSV upload component
- **Integration**: Seamlessly integrated into `BatchPaymentForm.tsx` with toggle button
- **Validation**: 
  - Checks for valid Stellar addresses
  - Validates amounts (must be positive numbers)
  - Supports optional asset and memo fields
- **Performance**: Handles large CSVs (100+ rows) without UI freeze
- **Testing**: Comprehensive test coverage with 8+ test cases covering:
  - File upload and parsing
  - Column mapping
  - Validation and error handling
  - Large file handling
  - Inline editing
  - Invalid data rejection

#### Files Changed
- `frontend/components/CSVUpload.tsx` (NEW) - CSV upload component
- `frontend/components/BatchPaymentForm.tsx` - Integrated CSV import button and modal
- `frontend/__tests__/CSVUpload.test.tsx` (NEW) - Comprehensive tests for CSV component
- `frontend/__tests__/BatchPaymentForm.test.tsx` - Added CSV integration tests

### Acceptance Criteria Met
- ✅ Drag-and-drop CSV file triggers parsing and preview
- ✅ Column mapping correctly routes CSV columns to form fields
- ✅ Invalid addresses shown with error message in preview
- ✅ "Import All Valid" adds only valid rows to batch
- ✅ CSV template downloads with correct headers
- ✅ Large CSVs (100+ rows) parse without UI freeze
- ✅ npm test ≥5 CSV upload test cases (8 test cases implemented)

### How to Use
1. Click the "📥 Import CSV" button in the Batch Send form
2. Drag and drop a CSV file or click to browse
3. Map CSV columns to payment fields (recipient, amount, asset, memo)
4. Review the validation preview - valid rows appear in green, invalid rows in red
5. Fix any errors by editing inline
6. Click "Import All Valid" to add rows to your batch payment list
7. Continue with normal batch payment workflow

### Testing
All existing tests pass. New tests added:
- 8 test cases for CSVUpload component
- 3 test cases for CSV integration in BatchPaymentForm
- Tests cover: file upload, parsing, validation, large files, error handling, and inline editing

### Notes
- CSV parsing is done entirely client-side for better performance and security
- Only valid rows are imported to prevent invalid transactions
- Users can edit values in the preview before importing for maximum flexibility
- Supports XLM and USDC tokens with extensibility for custom assets
