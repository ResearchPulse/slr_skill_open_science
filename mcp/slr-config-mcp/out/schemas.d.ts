import * as z from 'zod/v4';
export declare const noArgumentsSchema: z.ZodObject<{}, z.core.$strict>;
export declare const urlConfigSchema: z.ZodObject<{
    profileName: z.ZodOptional<z.ZodString>;
    apiBaseUrl: z.ZodString;
}, z.core.$strict>;
export declare const validateSchema: z.ZodObject<{
    profileName: z.ZodOptional<z.ZodString>;
    apiBaseUrl: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const tokenConfigSchema: z.ZodObject<{
    token: z.ZodString;
    profileName: z.ZodOptional<z.ZodString>;
    apiBaseUrl: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const commitSchema: z.ZodObject<{
    operationId: z.ZodString;
    action: z.ZodEnum<{
        save: "save";
        switch: "switch";
        update: "update";
    }>;
    profileName: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const cancelSchema: z.ZodObject<{
    operationId: z.ZodString;
}, z.core.$strict>;
//# sourceMappingURL=schemas.d.ts.map