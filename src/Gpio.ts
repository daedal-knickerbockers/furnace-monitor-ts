import fs from "fs";
import path from "path";

export const Direction = {
    INPUT: Buffer.from("Input"),
    OUTPUT: Buffer.from("Output"),
};

export enum PinState {
    HIGH = 1,
    LOW = 0,
}

enum OpenFileMode {
    READONLY = "r",
    WRITEONLY = "w",
    READWRITE = "rw",
}

export interface Watcher {
    gpioNumber: number;
    handler: (pinState: PinState) => Promise<void>;
}

export class WriteFileError extends Error {
    public constructor(public readonly filePath: string, error: Error) {
        super(`Failed to write to file ${filePath}: ${error.message}`);
    }
}

export class ReadFileError extends Error {
    public constructor(public readonly filePath: string, error: Error) {
        super(`Failed to read from file ${filePath}: ${error.message}`);
    }
}

export class OpenFileError extends Error {
    public constructor(public readonly filePath: string, error: Error) {
        super(`Failed to open file ${filePath}: ${error.message}`);
    }
}

export class Gpio {
    private readonly watchers: Watcher[] = [];
    private readonly watchedPins: { [gpio: number]: fs.FSWatcher } = {};

    public constructor(private readonly basepath: string = "/sys/class/gpio") {
        //
    }

    /**
     * Exports a gpio pin
     * @param gpioNumber the gpio pin to export
     * @throws WriteFileError if the export fails
     */
    public async export(gpioNumber: number): Promise<void> {
        const filePath = `export`;
        const buffer = Buffer.from(gpioNumber.toString());
        await this.writeToFile(filePath, buffer);
    }

    /**
     * Unexports a gpio pin
     * @param gpioNumber the gpio pin to unexport
     * @throws WriteFileError if the unexport fails
     */
    public async unexport(gpioNumber: number): Promise<void> {
        const filePath = `unexport`;
        const buffer = Buffer.from(gpioNumber.toString());
        await this.writeToFile(filePath, buffer);
    }

    /**
     * Writes a state to a gpio pin
     * @param gpioNumber the gpio pin to write to
     * @param pinState the state to write to the pin
     * @throws WriteFileError if the write fails
     */
    public async write(gpioNumber: number, pinState: PinState): Promise<void> {
        const filePath = `gpio${gpioNumber}/value`;
        const buffer = Buffer.from(pinState.toString(10));
        await this.writeToFile(filePath, buffer);
    }

    /**
     * Reads the state of a gpio pin
     * @param gpioNumber the gpio pin to read from
     * @returns the pin state of the gpio pin
     * @throws ReadFileError if the read fails
     */
    public async read(gpioNumber: number): Promise<PinState> {
        const filePath = `gpio${gpioNumber}/value`;
        const buffer = await this.readFromFile(filePath);
        const parsedValue = parseInt(buffer.toString(), 10);
        return parsedValue ? PinState.HIGH : PinState.LOW;
    }

    /**
     * Sets the direction of a gpio pin
     * @param gpioNumber the gpio pin to set the direction of
     * @param direction the direction to set the gpio pin to
     * @throws WriteFileError if the write fails
     */
    public async setDirection(gpioNumber: number, direction: keyof typeof Direction): Promise<void> {
        const filePath = `gpio${gpioNumber}/direction`;
        const buffer = Direction[direction];
        await this.writeToFile(filePath, buffer);
    }

    /**
     * Register a handler to be called when the state of a gpio pin changes
     * The handler will be initially called with the current state of the pin
     * @param gpioNumber the gpio pin to watch
     * @param handler the handler to call when the pin state changes
     * @throws ReadFileError if the read fails
     */
    public async watch(gpioNumber: number, handler: (pinState: PinState) => Promise<void>): Promise<void> {
        this.watchers.push({ gpioNumber, handler });
        if (!this.watchedPins[gpioNumber]) {
            await this.export(gpioNumber);
            await this.setDirection(gpioNumber, "INPUT");
            const fileWatcher = this.startWatching(gpioNumber);
            this.watchedPins[gpioNumber] = fileWatcher;
        }
    }

    private startWatching(gpioNumber: number): fs.FSWatcher {
        const filePath = `gpio${gpioNumber}/value`;
        const watchPath = this.buildPath(filePath);
        // fs.watch works fine with promises :shrug:
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        return fs.watch(watchPath, async (eventType) => {
            if (eventType === "change") {
                const currentPinState = await this.read(gpioNumber);
                const watchersToNotify = this.watchers.filter((watcher) => watcher.gpioNumber === gpioNumber);
                for (const watcher of watchersToNotify) {
                    await watcher.handler(currentPinState);
                }
            }
        });
    }

    private buildPath(filePath: string): string {
        return path.join(this.basepath, filePath);
    }

    private async openFile(filePath: string, mode: OpenFileMode): Promise<fs.promises.FileHandle> {
        try {
            return await fs.promises.open(this.buildPath(filePath), mode);
        } catch (error) {
            if (error instanceof Error) {
                throw new OpenFileError(filePath, error);
            } else {
                throw new OpenFileError(filePath, new Error("Unknown error"));
            }
        }
    }

    private async writeToFile(filePath: string, buffer: Buffer): Promise<void> {
        try {
            const file = await this.openFile(filePath, OpenFileMode.WRITEONLY);
            await file.write(buffer);
            await file.close();
        } catch (error) {
            if (error instanceof Error) {
                throw new WriteFileError(filePath, error);
            } else {
                throw new WriteFileError(filePath, new Error("Unknown error"));
            }
        }
    }

    private async readFromFile(filePath: string) {
        try {
            const file = await this.openFile(filePath, OpenFileMode.READONLY);
            const buffer = Buffer.alloc(1);
            await file.read(buffer, 0, 1, 0);
            await file.close();
            return buffer;
        } catch (error) {
            if (error instanceof Error) {
                throw new ReadFileError(filePath, error);
            } else {
                throw new ReadFileError(filePath, new Error("Unknown error"));
            }
        }
    }
}
