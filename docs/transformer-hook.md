# Transformer

Transformers are the core processing units in ETL pipelines that modify, enrich, or filter data records as they flow from source to destination. They provide the "T" (Transform) in your ETL workflow, allowing you to implement custom business logic for data processing.

## Overview

A transformer acts as a middleware function that receives a data record, processes it according to your requirements, and returns the transformed result. Each record flows through the transformer sequentially, making it ideal for data validation, enrichment, formatting, and conditional processing.

## Design Principles

When building transformers, consider these approaches for optimal reusability:

- **Generic Transformers**: Create reusable transformers that can work across multiple pipelines with similar data patterns
- **Pipeline-Specific Transformers**: Build specialized transformers for unique business logic that's tied to a specific data flow
- **Composable Logic**: Design transformers that can be easily combined or extended for complex processing requirements

## Transformer Specification

Your transformer function must implement the following signature:

```go
func Transformer(param *models.TransformerProps) (*models.Record, error)
```

### Parameters

The `TransformerProps` struct provides access to:

```go
type TransformerProps struct {
	State              IPipelineRuntimeState
	Record             *models.Record
	AuxiliaryDBConnMap map[string]IDatabaseConnInfo
}
```

`Record` wraps the data flowing through the pipeline:

```go
type Record struct {
	Data map[string]any // User-facing data that goes through transformations
	Meta map[string]any // Internal metadata preserved throughout the pipeline
}
```

`IPipelineRuntimeState` is a restricted, safe view of the running pipeline exposed to callbacks. It provides observable properties and controlled write operations:

```go
type IPipelineRuntimeState interface {
	GetName() string                       // Pipeline name
	GetFlowName() string                   // Parent flow name
	GetReplicaProps() map[string]any       // Shard/replica metadata
	GetLogger() ILoggerContract            // Structured logger
	GetDestinationWriteBatchSize() int     // Current batch size
}
```

### Return Values

- **Success**: Return the transformed record as `*models.Record`
- **Skip Record**: Return `nil, nil` to skip the current record and continue with the next
- **Error**: Return `nil, error` to halt pipeline execution with an error

## Implementation Example

```go
func Transformer(param *models.TransformerProps) (*models.Record, error) {
    rec := param.Record.Data

    // Skip records without required fields
    email, exists := rec["email"]
    if !exists || email == "" {
        return nil, nil
    }

    // Transform and enrich the record
    transformed := map[string]any{
        "customer_id": rec["id"],
        "email":       strings.ToLower(email.(string)),
        "full_name":   fmt.Sprintf("%s %s", rec["first_name"], rec["last_name"]),
        "created_at":  time.Now().UTC(),
    }

    // Add computed fields
    if phone, ok := rec["phone"].(string); ok && phone != "" {
        transformed["has_phone"] = true
        transformed["phone_formatted"] = formatPhoneNumber(phone)
    }

    return &models.Record{Data: transformed, Meta: param.Record.Meta}, nil
}

func formatPhoneNumber(phone string) string {
    digits := regexp.MustCompile(`\D`).ReplaceAllString(phone, "")
    if len(digits) == 10 {
        return fmt.Sprintf("(%s) %s-%s", digits[0:3], digits[3:6], digits[6:10])
    }
    return phone
}
```

## Creating a Transformer

### Step 1: Navigate to Transformers
In the left navigation panel, click on **Transformers** to access the transformer management interface.

### Step 2: Create New Transformer
1. Click **Create Transformer**
2. Provide a unique name for your transformer (e.g., `customer-data-enricher`)
3. Add an optional description explaining the transformer's purpose

### Step 3: Implement Your Logic
The code editor will present you with a template function. Replace the template with your custom transformation logic following the specification above.

## Best Practices

- **Error Handling**: Always validate input data and handle potential errors gracefully
- **Logging**: Use structured logging to track transformation progress and debug issues
- **Performance**: Avoid heavy computations; consider caching frequently used data
- **Idempotency**: Design transformers to produce consistent results when run multiple times
- **Documentation**: Add comments explaining complex business logic for maintainability